import { config } from "dotenv";
config();
import TelegramBot from "node-telegram-bot-api";
import { prisma } from "./prisma/prisma-client";
import express, { Request, Response } from "express";
import morgan from "morgan";
import {
    getOrderObjInternation,
    getOrderObjRu,
    getOrderTrackNumber,
    getToken,
    makeTrackNumber,
} from "./helpers/helpers";
import { TProduct, TWeb } from "./types/types";
import cors from "cors";
import { botOnStart } from "./helpers/bot-on-start";
import { ordersKeyboardEvent } from "./events/orders-keyboard-event";
import { updatePaymentInfo } from "./controllers/payment-controller";
import { MANAGER_CHAT_ID, WEB_APP } from "./config/config";
import { bot } from "./bot/bot";
import { handleCollectOrder } from "./callback-handlers/collect-order";
import { generateBarcode } from "./helpers/generate-barcode";
import { pollForBarcode } from "./helpers/getting-barcode";
import { orderRoutes } from "./routes/order-routes";

const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(morgan("dev"));
app.use(
    cors({
        origin: "*",
        methods: ["POST"],
        allowedHeaders: ["Content-Type"],
    })
);

app.use((req, res, next) => {
    if (req.body && req.body.length) {
        console.log(
            `Размер тела запроса: ${Buffer.byteLength(JSON.stringify(req.body))} байт`
        );
    } else {
        console.log("Тело запроса пустое");
    }
    next();
});

const WEB_CRM_APP = process.env.WEB_CRM_APP as string;

setTimeout(() => botOnStart(bot, MANAGER_CHAT_ID), 5000); // Функция, которая запускается при включении бота или перезагрузки

const timers = new Map(); // Объект для хранения таймеров по id заказа

// Сохранение timerId для заказа
function saveTimerIdForOrder(unique: string, timerId: NodeJS.Timeout) {
    timers.set(unique, timerId);
}

// Получение timerId для заказа
function getTimerIdForOrder(unique: string) {
    return timers.get(unique);
}

// Удаление таймера после получения скриншота
function removeTimerIdForOrder(unique: string) {
    timers.delete(unique);
    // console.log(`Таймер для заказа ${unique} удален.`);
}

bot.on("message", async (message: TelegramBot.Message) => {
    if (
        String(message.chat.id) === MANAGER_CHAT_ID &&
        message.text?.startsWith("/sendMessage")
    ) {
        const regex = /\/sendMessage\s+(\d+)\s+["“”]?([^"“”]+)["“”]?/;
        const match = message.text.match(regex);

        if (!match) {
            await bot.sendMessage(
                message.chat.id,
                'Формат команды: /sendMessage [telegramId] "[message]" (вводить без скобок)'
            );
            return;
        }

        const [, telegramId, msg] = match;

        await bot
            .sendMessage(telegramId, msg)
            .catch(
                async (err) =>
                    await bot.sendMessage(
                        MANAGER_CHAT_ID,
                        "[ЛОГИ]: Произошла ошибка при отправке сообщения: " +
                            err
                    )
            );
        await bot
            .sendMessage(MANAGER_CHAT_ID, "Сообщение успешно отправлено")
            .catch(
                async (err) =>
                    await bot.sendMessage(
                        MANAGER_CHAT_ID,
                        "[ЛОГИ]: Произошла ошибка при отправке сообщения: " +
                            err
                    )
            );
    }
});

bot.onText(
    /\/start( (.+))?/,
    async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
        const chatId = msg.chat.id;
        const telegramId = msg.chat.id;

        const user = await prisma.user.findFirst({
            where: {
                telegramId: telegramId.toString(),
            },
        });

        if (match && match[2]) {
            const generatedBasketKey = match[2];

            const basketItems = await prisma.generatedBaskets.findFirst({
                where: { cartKey: generatedBasketKey },
                include: { BasketItems: true, SecretDiscount: true }, // Подгружаем связанные элементы
            });

            await prisma.basket.deleteMany({ where: { userId: user?.userId } });

            if (!user) {
                await prisma.user.create({
                    data: {
                        telegramId: msg.chat.id.toString(),
                        userName: msg.chat.username?.toString() || "",
                    },
                });
            }
            const itemsArray = basketItems?.BasketItems || [];

            const secretDiscount = basketItems?.SecretDiscount;

            for (const item of itemsArray) {
                if (item) {
                    const productExists = await prisma.product.findFirst({
                        where: { productId: item.productId },
                    });

                    if (!productExists) {
                        continue;
                    }

                    if (secretDiscount?.type === "USED")
                        return bot.sendMessage(
                            chatId,
                            "Данная корзина уже была использована."
                        );

                    const userExist = await prisma.user.findFirst({
                        where: { telegramId: msg.chat.id.toString() },
                    });

                    await prisma.basket
                        .create({
                            data: {
                                userId: userExist?.userId!,
                                productId: item.productId,
                                productCount: item.productCount,
                                secretDiscountId: secretDiscount?.id,
                            },
                        })
                        .catch((err) => console.log(err));
                } else {
                    console.log(`Неверный формат: ${match[2]}`);
                }
            }

            bot.sendMessage(
                chatId,
                "Товары успешно добавлены в вашу корзину\nОсталось лишь открыть корзину:",
                {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "Открыть корзину",
                                    web_app: { url: `${WEB_APP}/basket` },
                                },
                            ],
                        ],
                    },
                }
            );
        } else {
            const chatId = msg.chat.id;

            if (msg.text === "/start") {
                const user = await prisma.user.findFirst({
                    where: { telegramId: msg.chat.id.toString() },
                });

                if (!user) {
                    await prisma.user.create({
                        data: {
                            telegramId: msg.chat.id.toString(),
                            userName: msg.chat.username?.toString() || "",
                        },
                    });
                }

                bot.sendMessage(
                    chatId,
                    "Чтобы сделать заказ нажмите на кнопку снизу",
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {
                                        text: "Открыть каталог",
                                        web_app: { url: WEB_APP },
                                    },
                                ],
                            ],
                        },
                    }
                );
            }
        }
    }
);

bot.on("message", (msg) => ordersKeyboardEvent(msg, bot, MANAGER_CHAT_ID));

app.post("/", async (req: Request<{}, {}, TWeb>, res: Response) => {
    const {
        selectedPvzCode,
        selectedTariff,
        telegramId,
        basket,
        queryId,
        totalPrice,
        surName,
        firstName,
        middleName,
        phone,
        products,
        uuid,
        selectedCountry,
        selectedCity,
        promocodeId,
        selectedCityName,
        deliverySum,
        bank,
        totalPriceWithDiscount,
        secretDiscountId,
        address,
        selectedCityCode
    } = req.body;

    try {
        const user = await prisma.user.findFirst({
            where: { telegramId: telegramId.toString() },
        });

        const isUserDidOrder = await prisma.order.findFirst({
            where: { status: "WAITPAY", userId: user?.userId },
        });

        if (isUserDidOrder) {
            bot.sendMessage(
                telegramId,
                "У вас есть неоплаченный заказ\n\nНапишите /start"
            );
            return res
                .status(400)
                .json({ message: "Ожидание оплаты предыдущего заказа" });
        }

        if (!basket || !queryId || !totalPrice) {
            await bot
                .answerWebAppQuery(queryId, {
                    type: "article",
                    id: queryId,
                    title: "Не удалось приобрести товар",
                    input_message_content: {
                        message_text:
                            "Не удалось приобрести товар\nНапишите /start и попробуйте позже",
                    },
                })
                .catch((err) => console.log(err));
            return res
                .status(400)
                .json({ message: "Все поля обязательны для заполнения" });
        }

        const uniqueProducts = products.filter((prod) => prod.productCount > 0);

        const orderId = uuid;

        const bankId = await prisma.bank
            .findFirst({ where: { bankName: bank } })
            .then((el) => el?.id);
        const secret = await prisma.secretDiscount.findFirst({
            where: { id: secretDiscountId },
        });
        if (bankId) {
            for (let prod of uniqueProducts) {
                const discount = await prisma.productDiscount.findFirst({
                    where: { productId: prod?.productId },
                });

                await prisma.order.create({
                    data: {
                        userId: user?.userId!,
                        orderUniqueNumber: orderId,
                        productCount: prod.productCount,
                        productId: prod.productId,
                        firstName,
                        middleName,
                        surName,
                        phone: phone,
                        deliveryCost: deliverySum!,
                        selectedPvzCode: selectedPvzCode,
                        selectedTariff: parseInt(selectedTariff),
                        bankId: bankId,
                        totalPrice: totalPrice,
                        totalPriceWithDiscount:
                            totalPriceWithDiscount &&
                            totalPriceWithDiscount !== totalPrice &&
                            totalPriceWithDiscount !== 0
                                ? totalPriceWithDiscount
                                : null,
                        selectedCountry: selectedCountry,
                        orderType: "CDEK",
                        promocodeId: promocodeId,
                        city: selectedCityName,
                        secretDiscountPercent: secretDiscountId
                            ? secret?.percent
                            : null,
                        productCostWithDiscount:
                            Number(prod.cost) * prod.productCount -
                            Number(prod.cost) *
                                Number(prod.productCount) *
                                (Number(discount?.percent) / 100),
                        address: address ? address : null
                    },
                });
            }
        }

        const handleScreenshotMessage = async (msg: TelegramBot.Message) => {
            if (msg.chat.id === telegramId) {
                if (msg.photo) {
                    bot.removeListener("message", handleScreenshotMessage);

                    const fileId = msg.photo[msg.photo.length - 1].file_id;

                    const user = await prisma.user.findFirst({
                        where: { telegramId: msg.chat.id.toString() },
                    });

                    const isOrderAlreadyUpdated = await prisma.order.findMany({
                        where: { orderUniqueNumber: orderId },
                    });

                    if (isOrderAlreadyUpdated[0].fileId) return;

                    await prisma.order.updateMany({
                        where: {
                            userId: user?.userId,
                            orderUniqueNumber: orderId,
                        },
                        data: { fileId: fileId },
                    });

                    try {
                        const promocode = promocodeId
                            ? await prisma.promocodes.findFirst({
                                  where: { promocodeId: promocodeId },
                              })
                            : undefined;
                        const messageToManager =
                            `${
                                msg.chat.username
                                    ? `<a href='https://t.me/${msg.chat.username}'>Пользователь</a>`
                                    : "Пользователь"
                            }` +
                            ` сделал заказ:\n${products
                                .filter((el) => el.productCount > 0)
                                .map(
                                    (el) =>
                                        `${el.productCount} шт. | ${el.synonym}`
                                )
                                .join(
                                    "\n"
                                )}\nTelegram ID: ${telegramId}\n\nФИО: ${surName} ${firstName} ${middleName}\nСтрана: ${
                                selectedCountry === "RU"
                                    ? "Россия"
                                    : selectedCountry === "KG"
                                      ? "Кыргызстан"
                                      : selectedCountry === "BY"
                                        ? "Беларусь"
                                        : selectedCountry === "AM"
                                          ? "Армения"
                                          : selectedCountry === "KZ"
                                            ? "Казахстан"
                                            : selectedCountry === "AZ"
                                              ? "Азербайджан"
                                              : selectedCountry === "UZ"
                                                ? "Узбекистан"
                                                : "Неизвестная страна"
                            }
                                 ${
                                     selectedCountry !== "RU"
                                         ? `\nГород: ${selectedCityName}\n<b>УЧТИТЕ, ЧТО КЛИЕНТ ТАКЖЕ ДОЛЖЕН ОПЛАТИТЬ ДОСТАВКУ</b>`
                                         : `\nГород: ${selectedCityName}\n`
                                 }
                                 \nНомер: ${phone.replace(
                                     /[ ()-]/g,
                                     ""
                                 )}\nПрайс: ${
                                     totalPriceWithDiscount
                                         ? totalPriceWithDiscount
                                         : totalPrice
                                 }\n` +
                            `\Доставка: ${deliverySum} ₽` +
                            `${
                                secretDiscountId
                                    ? `<blockquote>У данного клиента скидка на ${secret?.percent} ₽. Корзина сгенерирована менеджером.</blockquote>`
                                    : ""
                            }` +
                            `${
                                promocode
                                    ? `\n\n<blockquote>Данный пользователь использовал промокод: ${promocode?.title} на ${promocode?.percent} %</blockquote>`
                                    : ""
                            }`;

                        const order = await prisma.order.findFirst({
                            where: { orderUniqueNumber: orderId },
                        });

                        if (order && order.status === "WAITPAY") {
                            await bot
                                .sendPhoto(MANAGER_CHAT_ID, fileId, {
                                    caption: messageToManager,
                                    reply_markup: {
                                        inline_keyboard: [
                                            [
                                                {
                                                    text: "✅ Принять",
                                                    callback_data: `Принять_${orderId}`,
                                                },
                                                {
                                                    text: "❌ Удалить",
                                                    callback_data: `Удалить_${orderId}`,
                                                },
                                            ],
                                        ],
                                    },
                                    parse_mode: "HTML",
                                })
                                .then(async (msg) => {
                                    const newMessage =
                                        await prisma.messages.create({
                                            data: {
                                                bot_msg_id: String(
                                                    msg.message_id
                                                ),
                                                cdek_group_msg_id: "",
                                            },
                                        });

                                    await prisma.order.updateMany({
                                        where: { orderUniqueNumber: orderId },
                                        data: { messagesId: newMessage.id },
                                    });
                                })
                                .catch((err) => console.log(err));
                        } else {
                            console.log(
                                "Этот заказ уже обработан или отправлен."
                            );
                        }

                        // Обработчик callback_query для кнопок "Принять" и "Удалить"

                        await prisma.order.updateMany({
                            where: { orderUniqueNumber: orderId },
                            data: { status: "PENDING" },
                        });

                        if (secretDiscountId)
                            await prisma.secretDiscount.update({
                                where: { id: secretDiscountId },
                                data: { type: "USED" },
                            });
                        bot.sendMessage(
                            telegramId,
                            "Спасибо! Ваш скриншот принят.\n\nОжидайте подтверждения заказа нашим менеджером."
                        );
                    } catch (err) {
                        console.error("Ошибка отправки сообщения:", err);
                    }
                } else {
                    setTimeout(
                        () =>
                            bot.sendMessage(
                                telegramId,
                                "Пожалуйста, прикрепите скриншот чека, а не текстовое сообщение."
                            ),
                        500
                    );
                }
            }
        };

        await bot
            .answerWebAppQuery(queryId, {
                type: "article",
                id: queryId,
                title: "Ваш заказ",
                input_message_content: {
                    message_text:
                        `\n\nЗаказ:\n${products
                            .filter((el: any) => el.productCount > 0)
                            .map(
                                (el: any) =>
                                    `${el.productCount} шт. | ${el.synonym}`
                            )
                            .join("\n")}\n` +
                        `\nФИО ${surName} ${firstName} ${middleName}` +
                        "\nНомер " +
                        phone +
                        `\n\nДоставка: ${deliverySum} ₽` +
                        "\n\nПрайс: " +
                        `${
                            totalPriceWithDiscount &&
                            totalPriceWithDiscount !== 0
                                ? totalPriceWithDiscount
                                : totalPrice
                        }`,
                },
            })
            .catch((err) => console.log(err));

        const bankData = await prisma.bank.findFirst({
            where: { bankName: bank },
        });

        selectedCountry !== "RU"
            ? await bot
                  .sendMessage(
                      telegramId,
                      `К оплате: ${
                          totalPriceWithDiscount && totalPriceWithDiscount !== 0
                              ? totalPriceWithDiscount + Number(deliverySum)
                              : totalPrice + Number(deliverySum)
                      } ₽\n` +
                          `\n\nЕсли вы не с РФ, то просто переведите рубли на вашу валюту по актуальному курсу\n\n` +
                          `${
                              bankData?.paymentType === "BANK"
                                  ? `Банк: ${bankData?.bankName}\n`
                                  : `Сеть: ${bankData?.bankName}`
                          }` +
                          `${
                              bankData?.paymentType === "BANK"
                                  ? `Номер карты: <code>${bankData?.requisite}</code>\n`
                                  : `Адрес кошелька: <code>${bankData?.requisite}</code>`
                          }` +
                          `${
                              bankData?.sbpNumber &&
                              bankData?.sbpNumber?.length > 0 &&
                              bankData?.paymentType === "BANK"
                                  ? `Перевод по СБП: <code>${bankData?.sbpNumber}</code>\n`
                                  : ""
                          }` +
                          `Получатель: ${bankData?.recipient}\n\n` +
                          `<blockquote>${bankData?.comments}</blockquote>` +
                          `1) Отправьте боту <b>СКРИНШОТ</b> (не файл!) чека об оплате для завершения заказа.\n` +
                          `2) Если чек принят, бот вам ответит, что скриншот принят\n\n` +
                          `<b>⛔️ РЕКВИЗИТЫ АКТУАЛЬНЫ ТОЛЬКО В БЛИЖАЙШИЕ 90 МИНУТ‼️</b>\n\n` +
                          `<blockquote>Если вы не успели оплатить заказ за 90 минут, напишите менеджеру для повторного оформления заказа.</blockquote>\n\n` +
                          `Заказ оплачивается не позднее 23:59 (по московскому времени) текущего дня.`,
                      {
                          parse_mode: "HTML",
                          reply_markup: {
                              inline_keyboard: [
                                  [
                                      {
                                          text: "Без оплаты - отменится через 90 мин.",
                                          callback_data: "отмена",
                                      },
                                  ],
                              ],
                          },
                      }
                  )
                  .then(async (sentMessage) => {
                      await prisma.order.updateMany({
                          where: { orderUniqueNumber: orderId },
                          data: {
                              messageId: sentMessage.message_id.toString(),
                          },
                      });
                  })
                  .catch((err) => console.log(err))
            : await bot
                  .sendMessage(
                      user?.telegramId!,
                      `К оплате: ${
                          totalPriceWithDiscount && totalPriceWithDiscount !== 0
                              ? totalPriceWithDiscount
                              : totalPrice
                      } ₽\n\n` +
                          `${
                              bankData?.paymentType === "BANK"
                                  ? `Банк: ${bankData?.bankName}\n`
                                  : `Сеть: ${bankData?.bankName}\n`
                          }` +
                          `${
                              bankData?.paymentType === "BANK"
                                  ? `Номер карты: <code>${bankData?.requisite}</code>\n`
                                  : `Адрес кошелька: <code>${bankData?.requisite}</code>\n`
                          }` +
                          `${
                              bankData?.sbpNumber &&
                              bankData?.sbpNumber?.length > 0 &&
                              bankData?.paymentType === "BANK"
                                  ? `Перевод по СБП: <code>${bankData?.sbpNumber}</code>\n`
                                  : ""
                          }` +
                          `Получатель: ${bankData?.recipient}\n\n` +
                          `<blockquote>${bankData?.comments}</blockquote>` +
                          `1) Отправьте боту <b>СКРИНШОТ</b> (не файл!) чека об оплате для завершения заказа.\n` +
                          `2) Если чек принят, бот вам ответит, что скриншот принят\n\n` +
                          `<b>⛔️ РЕКВИЗИТЫ АКТУАЛЬНЫ ТОЛЬКО В БЛИЖАЙШИЕ 90 МИНУТ‼️</b>\n\n` +
                          `<blockquote>Если вы не успели оплатить заказ за 90 минут, напишите менеджеру для повторного оформления заказа.</blockquote>\n\n` +
                          `Заказ оплачивается не позднее 23:59 (по московскому времени) текущего дня.`,
                      {
                          parse_mode: "HTML",
                          reply_markup: {
                              inline_keyboard: [
                                  [
                                      {
                                          text: "Без оплаты - отменится через 90 мин.",
                                          callback_data: "отмена",
                                      },
                                  ],
                              ],
                          },
                      }
                  )
                  .then(async (sentMessage) => {
                      await prisma.order
                          .updateMany({
                              where: { orderUniqueNumber: orderId },
                              data: {
                                  messageId: sentMessage.message_id.toString(),
                              },
                          })
                          .catch((err) => console.log(err));
                  });

        const timerId = setTimeout(async () => {
            // Проверяем, поступил ли чек об оплате
            const order = await checkOrderStatus(orderId);
            if (!order?.isPaid) {
                const existingOrder = await prisma.order.findFirst({
                    where: { userId: user?.userId },
                });
                await bot
                    .deleteMessage(
                        user?.telegramId!,
                        Number(existingOrder?.messageId)
                    )
                    .catch((err) => console.log(err));
                await cancelOrder(orderId);
                bot.removeListener("message", handleScreenshotMessage);
                await bot
                    .sendMessage(
                        user?.telegramId!,
                        "Ваш заказ был автоматически отменен из-за отсутствия оплаты."
                    )
                    .catch((err) => console.log(err));
            }
        }, 5400000); // 90 мин = 5400000 миллисекунд

        saveTimerIdForOrder(orderId, timerId);

        async function onPaymentReceived(unique: string) {
            // Получаем timerId из базы или переменной
            const timerId = getTimerIdForOrder(unique);
            if (timerId) {
                // console.log(`Таймер для заказа ${unique} отменен, оплата получена.`);
                clearTimeout(timerId);
                removeTimerIdForOrder(unique);
            }
        }

        // Пример функций отмены заказа и проверки статуса
        async function cancelOrder(unique: string) {
            const order = await prisma.order.findFirst({
                where: { orderUniqueNumber: unique },
            });
            const orderList = await prisma.order.findMany({
                where: { orderUniqueNumber: unique },
            });
            const user = await prisma.user.findFirst({
                where: { userId: order?.userId! },
            });
            const keyboard = await prisma.keyboard.findFirst({
                where: { userId: order?.userId! },
            });

            if (keyboard) {
                await prisma.keyboard.deleteMany({
                    where: { userId: order?.userId! },
                });
                bot.deleteMessage(
                    user?.telegramId!,
                    Number(keyboard?.messageId!)
                ).catch((err) => console.log(err));
            }

            for (const ord of orderList) {
                const prod = await prisma.product.findFirst({
                    where: { productId: ord.productId! },
                });

                await prisma.product.update({
                    where: { productId: ord.productId! },
                    data: {
                        count: Number(prod?.count) + Number(ord.productCount),
                    },
                });
            }
            removeTimerIdForOrder(order?.orderUniqueNumber!);
            await prisma.order.deleteMany({
                where: { orderUniqueNumber: unique },
            });
            // console.log(`Заказ ${unique} был отменен.`);
        }
        async function checkOrderStatus(unique: string) {
            const order = await prisma.order.findFirst({
                where: { orderUniqueNumber: unique },
            });

            if (order?.status === "WAITPAY") {
                return { isPaid: false }; // Здесь возвращаем статус заказа
            } else if (order?.status === "PENDING") {
                onPaymentReceived(unique); // Если оплата получена, отменяем таймер
            }
            return { isPaid: true };
        }
        bot.on("message", handleScreenshotMessage);

        await prisma.basket.deleteMany({ where: { userId: user?.userId } });
        return res.status(200).json({ message: "Заказ успешно оформлен" });
    } catch (err) {
        console.error("Ошибка в процессе выполнения:", err);
        return res.status(500).json({ message: "Внутренняя ошибка сервера" });
    }
});

// app.post('/', async (req, res) => console.log('запрос принимается'))

async function getOrderData(orderId: string) {
    // Предполагаем, что данные заказов хранятся в базе данных
    const order = await prisma.order.findFirst({
        where: { orderUniqueNumber: orderId },
    });

    const entireOrders = await prisma.order.findMany({
        where: { orderUniqueNumber: orderId },
    });

    if (!order) {
        throw new Error("Заказ не найден");
    }

    const user = await prisma.user.findFirst({
        where: { userId: order?.userId! },
    });

    const products = await prisma.product.findMany();

    const orderProds: TProduct[] = [];

    for (const order of entireOrders) {
        products.map((prod) => {
            if (prod.productId === order.productId && order.productCount > 0) {
                orderProds.push({
                    cost: Number(prod.cost),
                    count: prod.count,
                    productId: 0,
                    name: prod.name,
                    synonym: prod.synonym || "",
                    description: prod.description,
                    picture: prod.picture || "",
                    productCount: order.productCount,
                });
            }
        });
    }

    return {
        telegramId: user?.telegramId,
        trackNumber: order?.orderTrackNumber,
        im_number: order?.orderUniqueNumber,
        products: orderProds,
        surName: order?.surName,
        firstName: order?.firstName,
        middleName: order?.middleName,
        phone: order?.phone,
        selectedPvzCode: order?.selectedPvzCode,
        selectedTariff: order?.selectedTariff,
        totalPrice: order?.totalPrice,
        totalPriceWithDiscount: order?.totalPriceWithDiscount,
        deliveryCost: order?.deliveryCost,
        username: user?.userName,
        selectedCountry: order?.selectedCountry,
        status: order?.status,
        fileId: order?.fileId,
        cityName: order?.city,
        secretDiscountPercent: order?.secretDiscountPercent,
        address: order?.address
    };
}

export const handleCallbackQuery = async (query: TelegramBot.CallbackQuery) => {
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;

    if (!query.data) {
        console.error("Отсутствует callback_data");
        return;
    }
    const [action, orderUnique] = query.data.split("_");

    try {
        if (action === "Принять") {
            // Менеджер нажал "Принять"

            const authData = await getToken({
                grant_type: "client_credentials",
                client_id: process.env.CLIENT_ID!,
                client_secret: process.env.CLIENT_SECRET!,
            });

            // выполнение заказа и получение трек номера

            const orderData = await getOrderData(orderUnique);

            if (orderData?.status === "SUCCESS")
                return bot
                    .sendMessage(MANAGER_CHAT_ID, "Данный заказ уже принят")
                    .catch((err) => console.log(err));

            const cityCode = await prisma.cdekOffice.findFirst({where: {City: orderData?.cityName!}})
            .catch(err => console.log(err))
            .then(pvz => pvz?.cityCode)

            const getobj =
                orderData?.selectedCountry === "RU"
                    ? await getOrderObjRu(
                          authData?.access_token,
                          orderUnique,
                          orderData?.totalPrice,
                          orderData?.surName!,
                          orderData?.firstName!,
                          orderData?.middleName!,
                          orderData?.phone!,
                          orderData?.selectedPvzCode!,
                          orderData.deliveryCost!,
                          orderData?.selectedTariff!,
                          orderData?.address!,
                          cityCode!
                          
                      )
                    : await getOrderObjInternation(
                          authData?.access_token,
                          orderUnique,
                          orderData?.totalPrice,
                          orderData?.surName!,
                          orderData?.firstName!,
                          orderData?.middleName!,
                          orderData?.phone!,
                          orderData?.selectedPvzCode!,
                          orderData.deliveryCost!,
                          orderData?.selectedTariff!,
                          orderData?.address!,
                          cityCode!
                      );

            const delay = (ms: number) =>
                new Promise((resolve) => setTimeout(resolve, ms));

            await makeTrackNumber(getobj);

            if (orderData && orderData.im_number) {
                await delay(2000);

                const orderCdekData = await getOrderTrackNumber(
                    orderData?.im_number,
                    authData?.access_token!
                ).then((order) => order.entity);

                const orderTrackNumberForUser = orderCdekData.cdek_number;

                await prisma.order.updateMany({
                    where: { orderUniqueNumber: orderData?.im_number },
                    data: {
                        status: "SUCCESS",
                        orderTrackNumber: orderTrackNumberForUser,
                    },
                });
                // --------------------------------------------------
                await bot
                    .sendMessage(
                        orderData.telegramId!,
                        `Ваш заказ принят!\nВот трек-номер: ${orderTrackNumberForUser}\n\n` +
                            `Благодарим за покупку, ${orderData?.surName} ${orderData?.firstName} ${orderData?.middleName}!\n\n` +
                            `Ваш заказ:\n${orderData.products
                                .map(
                                    (el) =>
                                        `${el.productCount} шт. | ${el.synonym}`
                                )
                                .join("\n")}\n\n` +
                            `Отправка посылки осуществляется в течение 4х дней после оплаты (кроме праздничных дней и воскресения).\n\n` +
                            `Если в течение 4х дней статус заказа не изменился, сообщите <a href="https://t.me/ManageR_triple_h">нам</a> об этом.\n\n` +
                            `Ссылка на резервную группу:\nhttps://t.me/+FiEPDjQgSdswYTAy\n\n` +
                            `Претензии по состоянию товара и соответствию заказа рассматриваются только при наличии видео фиксации вскрытия упаковки!`,
                        {
                            parse_mode: "HTML",
                            disable_web_page_preview: true,
                        }
                    )
                    .catch((err) => console.log(err));

                const timestamp = new Date();

                const acceptOrderMessage =
                    `Заказ ${
                        orderData?.username
                            ? `<a href="${`https://t.me/${orderData?.username}`}">клиента</a>`
                            : "клиента"
                    }` +
                    ` принят.\nTelegram ID: ${orderData?.telegramId}\n\n` +
                    `\nТрек-номер: ${orderTrackNumberForUser} \n\nПеречень заказа:\n` +
                    `${orderData.products
                        .map((el) => `${el.productCount} шт. | ${el.synonym}`)
                        .join("\n")}\n\nПрайс: ${
                        orderData?.totalPriceWithDiscount
                            ? orderData?.totalPriceWithDiscount
                            : orderData?.totalPrice
                    }\n\n` +
                    `Данные клиента:\n` +
                    `${orderData?.surName} ${orderData?.firstName} ${orderData?.middleName}\nГород: ${orderData?.cityName}\n` +
                    `Номер: ${orderData?.phone?.replace(/[ ()-]/g, "")}\n\n` +
                    `${
                        orderData?.secretDiscountPercent
                            ? `<blockquote>У данного клиента скидка на ${orderData?.secretDiscountPercent} ₽. Корзина сгенерирована менеджером.</blockquote>`
                            : ""
                    }` +
                    `Время: ${timestamp.getDate()}.${
                        timestamp.getMonth() + 1 < 10
                            ? "0" + (timestamp.getMonth() + 1)
                            : timestamp.getMonth() + 1
                    }.` +
                    `${timestamp.getFullYear()}  ${
                        timestamp.getHours() < 10
                            ? "0" + timestamp.getHours()
                            : timestamp.getHours()
                    }:` +
                    `${
                        timestamp.getMinutes() < 10
                            ? "0" + timestamp.getMinutes()
                            : timestamp.getMinutes()
                    }`;

                await bot
                    .editMessageCaption(acceptOrderMessage, {
                        message_id: messageId,
                        chat_id: chatId,
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {
                                        text: "❌ Удалить",
                                        callback_data: `Удалить_${orderData?.im_number}`,
                                    },
                                ],
                            ],
                        },
                        parse_mode: "HTML",
                    })
                    .catch(
                        async (err) =>
                            await bot.sendMessage(
                                MANAGER_CHAT_ID,
                                "[ЛОГИ]: Ошибка: " + err
                            )
                    );

                const barcode_uuid = await generateBarcode(
                    orderCdekData.uuid,
                    authData?.access_token
                ).then((barcode) => barcode.entity.uuid);

                const barcode_url = await pollForBarcode(
                    barcode_uuid,
                    authData?.access_token!
                );

                // Записываем barcode в бд

                const barcodeId = await prisma.orderBarcode
                    .create({ data: { url: barcode_url } })
                    .then((el) => el.id);

                // записываем barcodeId в Order

                await prisma.order
                    .updateMany({
                        where: { orderUniqueNumber: orderData?.im_number },
                        data: { orderBarcodeId: barcodeId },
                    })
                    .catch((err) => console.log(err));

                await bot
                    .sendMessage(
                        process.env.CDEK_GROUP_ID!,
                        `Заказ ${
                            orderData?.username
                                ? `<a href="${`https://t.me/${orderData?.username}`}">клиента</a>`
                                : "клиента"
                        }` +
                            ` принят.\nTelegram ID: ${orderData?.telegramId}\n\nТрек-номер: ${orderTrackNumberForUser}.\n <a href="${barcode_url}">Ссылка</a>\n\nПеречень заказа:\n${orderData.products
                                .map(
                                    (el) =>
                                        `${el.productCount} шт. | ${el.synonym}`
                                )
                                .join("\n")}\n\nПрайс: ${
                                orderData?.totalPriceWithDiscount
                                    ? orderData?.totalPriceWithDiscount
                                    : orderData?.totalPrice
                            }\n\n` +
                            `Данные клиента:\n` +
                            `${orderData?.surName} ${orderData?.firstName} ${orderData?.middleName}\nГород: ${orderData?.cityName}\n` +
                            `Номер: ${orderData?.phone?.replace(
                                /[ ()-]/g,
                                ""
                            )}\n\n` +
                            `${
                                orderData?.secretDiscountPercent
                                    ? `<blockquote>Скидка ${orderData?.secretDiscountPercent} ₽ на корзину.</blockquote>`
                                    : ""
                            }` +
                            `Время: ${timestamp.getDate()}.${
                                timestamp.getMonth() + 1 < 10
                                    ? "0" + (timestamp.getMonth() + 1)
                                    : timestamp.getMonth() + 1
                            }.` +
                            `${timestamp.getFullYear()}  ${
                                timestamp.getHours() < 10
                                    ? "0" + timestamp.getHours()
                                    : timestamp.getHours()
                            }:` +
                            `${
                                timestamp.getMinutes() < 10
                                    ? "0" + timestamp.getMinutes()
                                    : timestamp.getMinutes()
                            }`,
                        {
                            parse_mode: "HTML",
                            disable_web_page_preview: true,
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        {
                                            text: "Собрать заказ",
                                            callback_data: `collect_order:${orderTrackNumberForUser}`,
                                        },
                                    ],
                                    [
                                        {
                                            text: "Отредактировать",
                                            url: `${WEB_CRM_APP}/orderedit/${orderUnique}`,
                                        },
                                    ],
                                ],
                            },
                        }
                    )
                    .then(async (msg) => {
                        const dbMessageId = await prisma.order
                            .findFirst({
                                where: { orderUniqueNumber: orderUnique },
                            })
                            .then((msg) => msg?.messagesId);
                        if (dbMessageId) {
                            await prisma.messages.update({
                                where: { id: dbMessageId },
                                data: {
                                    cdek_group_msg_id: String(msg.message_id),
                                },
                            });
                        }
                    })
                    .catch((err) => console.log(err));
            }
        } else if (action === "Удалить") {
            // Действие для удаления заказа

            const order = await prisma.order.findFirst({
                where: { orderUniqueNumber: orderUnique },
            });

            const user = await prisma.user.findFirst({
                where: { userId: order?.userId! },
            });

            await prisma.order.deleteMany({
                where: { orderUniqueNumber: orderUnique },
            });

            if (user)
                await bot
                    .sendMessage(
                        user?.telegramId,
                        "К сожалению ваш заказ был удалён"
                    )
                    .catch((err) => console.log(err));

            await bot
                .editMessageCaption("Заказ был удален.", {
                    chat_id: chatId,
                    message_id: messageId,
                })
                .catch((err) => console.log(err));
        } else if (action === "УдалитьNEOPL") {
            const orders = await prisma.order.findMany({
                where: { orderUniqueNumber: orderUnique },
            });
            const user = await prisma.user.findFirst({
                where: { userId: orders[0]?.userId! },
            });
            const keyboard = await prisma.keyboard.findFirst({
                where: { userId: user?.userId },
            });

            if (user && keyboard) {
                await prisma.order.deleteMany({
                    where: { orderUniqueNumber: orderUnique },
                });

                await bot
                    .sendMessage(user?.telegramId, "Заказ успешно удален")
                    .catch((err) => console.log(err));
                await bot
                    .deleteMessage(
                        user?.telegramId,
                        Number(keyboard?.messageId)
                    )
                    .catch((err) => console.log(err));
                await prisma.keyboard.delete({
                    where: { keyboardId: keyboard?.keyboardId },
                });
            }
        }

        // Закрываем callback
        await bot
            .answerCallbackQuery(query.id)
            .catch((err) => console.log(err));
    } catch (err) {
        console.error("Ошибка обработки заказа:", err);
    }
};

// Обработчик callback_query при order collect
bot.on("callback_query", handleCollectOrder);

bot.on("callback_query", handleCallbackQuery);

app.post("/update-payment-info", updatePaymentInfo);
app.use("/order", orderRoutes);

app.listen(7000, () => {
    console.log("Запущен на 7000 порте");
});
