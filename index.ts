import { config } from "dotenv";
config();
import TelegramBot from "node-telegram-bot-api";
import { prisma } from "./prisma/prisma-client";
import express, { Request, Response } from "express";
import morgan from "morgan";
import {
  getOrderObjInternation,
  getOrderObjRu,
  getOrderObjRuWithPrepayment,
  getOrderTrackNumber,
  getToken,
  makeTrackNumber,
} from "./helpers/helpers";
import { TProduct, TWeb } from "./types/types";
import cors from "cors";
import { botOnStart } from "./helpers/bot-on-start";
import { ordersKeyboardEvent } from "./events/orders-keyboard-event";
import { updatePaymentInfo } from "./controllers/payment-controller";
import { MANAGER_CHAT_ID, token, WEB_APP } from "./config/config";
import { bot } from "./bot/bot";
import { handleCollectOrder } from "./callback-handlers/collect-order";
import { generateBarcode } from "./helpers/generate-barcode";
import { pollForBarcode } from "./helpers/getting-barcode";
import { orderRoutes } from "./routes/order-routes";
import {
  getTimerIdForOrder,
  removeTimerIdForOrder,
  saveTimerIdForOrder,
} from "./map-func/order-timer";
import { mailRoutes } from "./routes/mail-routes";
import { makeMailRuDelivery } from "./helpers/mail-delivery/mail-delivery-ru";
import { mailingRoutes } from "./routes/mailing-routes";
import { CdekOffice } from "@prisma/client";

const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(morgan("dev"));
app.use(
  cors({
    origin: "*",
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(express.json());

const WEB_CRM_APP = process.env.WEB_CRM_APP as string;

setTimeout(() => botOnStart(bot, MANAGER_CHAT_ID), 3000); // Функция, которая запускается при включении бота или перезагрузки

export const sendMessageHandler = async (message: TelegramBot.Message) => {
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
            "[ЛОГИ]: Произошла ошибка при отправке сообщения: " + err
          )
      );
    await bot
      .sendMessage(MANAGER_CHAT_ID, "Сообщение успешно отправлено")
      .catch(
        async (err) =>
          await bot.sendMessage(
            MANAGER_CHAT_ID,
            "[ЛОГИ]: Произошла ошибка при отправке сообщения: " + err
          )
      );
  }
};

bot.on("message", sendMessageHandler);

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
                freeDelivery: basketItems?.freeDelivery,
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

        bot.sendMessage(chatId, "Чтобы сделать заказ нажмите на кнопку снизу", {
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
        });
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
    selectedCityCode,
    commentByUser,
  } = req.body;

  try {
    const user = await prisma.user.findFirst({
      where: { telegramId: telegramId.toString() },
    });

    if (!user) {
      return res.status(404).json({ message: "Пользователь не найден" });
    }

    const pending = await prisma.order.findFirst({
      where: { status: "WAITPAY", userId: user.userId },
    });

    if (pending) {
      await prisma.order.deleteMany({
        where: { status: "WAITPAY", userId: user.userId },
      });
      console.log('Старый заказ удалён')
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
            secretDiscountPercent: secretDiscountId ? secret?.percent : null,
            productCostWithDiscount:
              Number(prod.cost) * prod.productCount -
              Number(prod.cost) *
                Number(prod.productCount) *
                (Number(discount?.percent) / 100),
            address: address ? address : null,
            commentByClient: commentByUser ? commentByUser : null,
            freeDelivery: basket[0]?.freeDelivery,
          },
        });
      }
    }
    const cdekOffice = await prisma.cdekOffice
      .findFirst({
        where: { code: selectedPvzCode },
      })
      .catch((err) => console.log(err));

    if (!cdekOffice) return;
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

          if (isOrderAlreadyUpdated[0]?.fileId) return;

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

            const isRussia = selectedCountry === "RU";
            const hasDiscount = !!totalPriceWithDiscount;
            const deliveryCost = Number(deliverySum);

            const basePrice = hasDiscount ? totalPriceWithDiscount : totalPrice;
            const fullPrice = basePrice + deliveryCost;

            // Определяем финальную сумму
            const priceToPay =
              // Если доставка не в РФ или нет наложенного платежа — платит сразу с доставкой
              !isRussia || !cdekOffice.allowed_cod ? fullPrice : basePrice;

            // Определяем пояснение
            const paymentNote =
              !isRussia || !cdekOffice.allowed_cod
                ? "<strong>должен оплатить вместе с доставкой</strong>"
                : "<strong>должен оплатить без учета доставки</strong>";

            // Определяем текст по доставке
            const deliveryNote = basket[0]?.freeDelivery
              ? "Доставка: <strong>Бесплатно</strong>"
              : cdekOffice.allowed_cod && isRussia
                ? `Доставка: ${deliveryCost} ₽`
                : "";

            const result = `Прайс: ${priceToPay} ₽ ${paymentNote}\n ${deliveryNote}`;

            const messageToManager =
              `${
                msg.chat.username
                  ? `<a href='https://t.me/${msg.chat.username}'>Пользователь</a>`
                  : "Пользователь"
              }` +
              ` сделал заказ:\n${products
                .filter((el) => el.productCount > 0)
                .map((el) => `${el.productCount} шт. | ${el.synonym}`)
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
                                 \nНомер: ${phone.replace(
                                   /[ ()-]/g,
                                   ""
                                   //  TODO: Указать с доставкой ли оплата или без неё
                                 )}\n` +
              `${result}` +
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
                  const newMessage = await prisma.messages.create({
                    data: {
                      bot_msg_id: String(msg.message_id),
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
              console.log("Этот заказ уже обработан или отправлен.");
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
              .map((el: any) => `${el.productCount} шт. | ${el.synonym}`)
              .join("\n")}\n` +
            `\nФИО ${surName} ${firstName} ${middleName}` +
            "\nНомер " +
            phone +
            `\n\n${!!basket[0]?.freeDelivery ? "Доставка: Бесплатно" : `Доставка: ${deliverySum} ₽`}` +
            "\n\nПрайс: " +
            `${
              totalPriceWithDiscount && totalPriceWithDiscount !== 0
                ? totalPriceWithDiscount
                : totalPrice
            }`,
        },
      })
      .catch((err) => console.log(err));

    const bankData = await prisma.bank.findFirst({
      where: { bankName: bank },
    });

    // При доставке заграницу
    let paymentInfoInter = "";

    if (totalPriceWithDiscount && totalPriceWithDiscount !== 0) {
      paymentInfoInter = `${totalPriceWithDiscount + Number(deliverySum)}`;
    } else {
      paymentInfoInter = `${totalPrice + Number(deliverySum)}`;
    }

    // При доставке в РФ
    let paymentInfoRu = "";

    if (
      totalPriceWithDiscount &&
      totalPriceWithDiscount !== 0 &&
      totalPriceWithDiscount !== totalPrice
    ) {
      if (address) {
        paymentInfoRu = `${totalPriceWithDiscount + Number(deliverySum)}`;
      } else if (cdekOffice.allowed_cod) {
        paymentInfoRu = `${totalPriceWithDiscount}`;
      } else {
        paymentInfoRu = `${totalPriceWithDiscount + Number(deliverySum)}`;
      }
    } else {
      if (address) {
        paymentInfoRu = `${totalPrice + Number(deliverySum)}`;
      } else if (cdekOffice.allowed_cod) {
        paymentInfoRu = `${totalPrice}`;
      } else {
        paymentInfoRu = `${totalPrice + Number(deliverySum)}`;
      }
    }

    selectedCountry !== "RU"
      ? await bot
          .sendMessage(
            telegramId,
            `К оплате: ${paymentInfoInter} ₽\n` +
              `\nЕсли вы не с РФ, то просто переведите рубли на вашу валюту по актуальному курсу\n\n` +
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
              `${
                bankData?.comments
                  ? `<blockquote>${bankData?.comments}</blockquote>`
                  : ""
              }` +
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
            `К оплате: ${paymentInfoRu} ₽\n\n` +
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
              `${
                bankData?.comments
                  ? `<blockquote>${bankData?.comments}</blockquote>`
                  : ""
              }` +
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
          .deleteMessage(user?.telegramId!, Number(existingOrder?.messageId))
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
        bot
          .deleteMessage(user?.telegramId!, Number(keyboard?.messageId!))
          .catch((err) => console.log(err));
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
  const promocode =
    order?.promocodeId &&
    (await prisma.promocodes.findFirst({
      where: { promocodeId: order?.promocodeId },
    }));

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
    address: order?.address,
    country: order?.selectedCountry,
    region: order?.region,
    index: order?.index,
    pvzCode: order?.pvzCode,
    commentByUser: order?.commentByClient,
    promocode: promocode,
    freeDelivery: order?.freeDelivery,
  };
}
const MAIL_GROUP_ID = process.env.MAIL_GROUP_ID!;
const MAIL_GROUP_RU_ID = process.env.MAIL_GROUP_RU_ID!;
const POSTOFFICE_CODE = process.env.POSTOFFICE_CODE as string;
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
      const authData = await getToken({
        grant_type: "client_credentials",
        client_id: process.env.CLIENT_ID!,
        client_secret: process.env.CLIENT_SECRET!,
      });

      if (!chatId) return console.log("chatId не найден");

      const orderData = await getOrderData(orderUnique);

      if (orderData?.status === "SUCCESS")
        return bot
          .sendMessage(MANAGER_CHAT_ID, "Данный заказ уже принят")
          .catch((err) => console.log(err));

      if (!orderData?.selectedPvzCode && !orderData?.address) {
        return await bot.sendMessage(chatId, "selectedPvzCode не найден");
      }

      let cdekOffice: CdekOffice | null = null;

      const cityRecordPromise = prisma.cdekOffice.findFirst({
        where: { City: orderData.cityName! },
      });

      const cityRecord = await cityRecordPromise.catch((err) => {
        console.error("Ошибка при cityCode:", err);
        return null;
      });
      const cityCode = cityRecord?.cityCode;

      if (!orderData.address) {
        cdekOffice = await prisma.cdekOffice
          .findFirst({
            where: {
              City: orderData.cityName!,
              code: orderData.selectedPvzCode as string,
            },
          })
          .catch((err) => {
            console.error("Ошибка при поиске cdekOffice:", err);
            return null;
          });

        if (!cdekOffice) {
          return await bot.sendMessage(chatId, "cdekOffice не найден");
        }
      }

      const isRussian = orderData?.selectedCountry === "RU";
      const allowedCod = isRussian ? Boolean(cdekOffice?.allowed_cod) : false;

      let getOrderObject;

      if (isRussian) {
        if (allowedCod) {
          getOrderObject = await getOrderObjRu(
            authData?.access_token!,
            orderUnique,
            orderData.totalPrice!,
            orderData.surName!,
            orderData.firstName!,
            orderData.middleName!,
            orderData.phone!,
            orderData.selectedPvzCode!,
            orderData.deliveryCost!,
            orderData.selectedTariff!,
            orderData.address!,
            cityCode!,
            orderData.freeDelivery
          );
        } else {
          getOrderObject = await getOrderObjRuWithPrepayment(
            authData?.access_token!,
            orderUnique,
            orderData.totalPrice!,
            orderData.surName!,
            orderData.firstName!,
            orderData.middleName!,
            orderData.phone!,
            orderData.selectedPvzCode!,
            orderData.deliveryCost!,
            orderData.selectedTariff!,
            orderData.address!,
            cityCode!,
            orderData.freeDelivery
          );
        }
      } else {
        getOrderObject = await getOrderObjInternation(
          authData?.access_token!,
          orderUnique,
          orderData.totalPrice!,
          orderData.surName!,
          orderData.firstName!,
          orderData.middleName!,
          orderData.phone!,
          orderData.selectedPvzCode!,
          orderData.deliveryCost!,
          orderData.selectedTariff!,
          orderData.address!,
          cityCode!
        );
      }
      const delay = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));

      await makeTrackNumber(getOrderObject);

      if (orderData && orderData.im_number) {
        await delay(2000);

        const orderCdekData = await getOrderTrackNumber(
          orderData?.im_number,
          authData?.access_token!
        ).then((order) => order.entity);

        const orderTrackNumberForUser = orderCdekData.cdek_number;

        if (!orderTrackNumberForUser)
          return await bot.sendMessage(
            chatId,
            `Заказ с номером: ${orderCdekData.uuid} не удалось зарегистрировать.`
          );

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
            `Ваш заказ оформлен!\nВот трек-номер: ${orderTrackNumberForUser}\n(если нет трек-номера, то обратитесь к <a href="https://t.me/ManageR_triple_h">консультанту</a>)\n\n` +
              `Благодарим за покупку, ${orderData?.surName} ${orderData?.firstName} ${orderData?.middleName}!\n\n` +
              `Ваш заказ:\n${orderData.products
                .map((el) => `${el.productCount} шт. | ${el.synonym}`)
                .join("\n")}\n\n` +
              `Отправка посылки осуществляется в течение 4х дней после оплаты (кроме праздничных дней и воскресения).\n\n` +
              `Если в течение 4х дней статус заказа не изменился, сообщите <a href="https://t.me/ManageR_triple_h">нам</a> об этом.\n\n` +
              `Канал 1:\nhttps://t.me/+6MR4nDee-YA5ZWUy\nКанал 2:\nhttps://t.me/+aeKR9GmiV2cxOTFi\n\nРезервная группа:\nhttps://t.me/+FiEPDjQgSdswYTAy\n\n` +
              `ПРЕТЕНЗИИ по состоянию товара и соответствию заказа рассматриваются ТОЛЬКО ПРИ НАЛИЧИИ ВИДЕО фиксации вскрытия упаковки!`,
            {
              parse_mode: "HTML",
              disable_web_page_preview: true,
            }
          )
          .catch((err) => console.log(err));

        const timestamp = new Date();

        const isRu = orderData?.selectedCountry === "RU";
        const isCourier = Boolean(orderData?.address);
        const hasDiscount = Boolean(orderData?.totalPriceWithDiscount);
        const allowedCOD = cdekOffice?.allowed_cod;

        let priceToPay: number;
        let paymentNote: string;

        if (isCourier) {
          // Курьер — учитываем доставку в платеже
          priceToPay = hasDiscount
            ? Number(orderData!.totalPriceWithDiscount) +
              Number(orderData!.deliveryCost)
            : Number(orderData!.totalPrice) + Number(orderData!.deliveryCost);
          paymentNote = "<strong>должен оплатить с учетом доставки</strong>";
        } else if (isRu) {
          // Самовывоз в РФ — учитываем allowed_cod
          if (allowedCOD) {
            priceToPay = hasDiscount
              ? Number(orderData!.totalPriceWithDiscount)
              : Number(orderData!.totalPrice);
            paymentNote = "<strong>должен оплатить без учета доставки</strong>";
          } else {
            priceToPay = hasDiscount
              ? Number(orderData!.totalPriceWithDiscount) +
                Number(orderData!.deliveryCost)
              : Number(orderData!.totalPrice) + Number(orderData!.deliveryCost);
            paymentNote = "<strong>должен оплатить вместе с доставкой</strong>";
          }
        } else {
          // Международная доставка — всегда учитываем доставку
          priceToPay = hasDiscount
            ? Number(orderData!.totalPriceWithDiscount) +
              Number(orderData!.deliveryCost)
            : Number(orderData!.totalPrice) + Number(orderData!.deliveryCost);
          paymentNote = "<strong>должен оплатить с учетом доставки</strong>";
        }

        const productsList = orderData?.products
          .map((el) => `${el.productCount} шт. | ${el.synonym}`)
          .join("\n");

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
            .join("\n")}\n\n` +
          `Прайс: ${priceToPay} ${paymentNote}` +
          `\nДоставка: ${orderData?.deliveryCost}\n\nДанные клиента:\n` +
          `${orderData?.surName} ${orderData?.firstName} ${orderData?.middleName}\nГород: ${orderData?.cityName}\n` +
          `Номер: ${orderData?.phone?.replace(/[ ()-]/g, "")}\n\n` +
          `${
            orderData?.secretDiscountPercent
              ? `<blockquote>У данного клиента скидка на ${orderData?.secretDiscountPercent} ₽. Корзина сгенерирована менеджером.</blockquote>`
              : ""
          }` +
          `${orderData?.promocode ? `<blockquote>Данный пользователь использовал промокод:  ${orderData?.promocode.title} на ${orderData?.promocode?.percent} %</blockquote>` : ""}` +
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
              await bot.sendMessage(MANAGER_CHAT_ID, "[ЛОГИ]: Ошибка: " + err)
          );

        const barcode_uuid = await generateBarcode(
          orderCdekData.uuid,
          authData?.access_token
        ).then((barcode) => barcode.entity.uuid);

        await new Promise((resolve) => setTimeout(resolve, 500));

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
                  ? `<blockquote>Скидка ${orderData?.secretDiscountPercent} ₽ на корзину.</blockquote>`
                  : ""
              }` +
              `${orderData?.promocode ? `<blockquote>Данный пользователь использовал промокод: <strong>${orderData?.promocode.title}</strong> на <strong>${orderData?.promocode?.percent} %</strong></blockquote>` : ""}` +
              `${orderData?.commentByUser ? `\nКомм. клиента: ${orderData?.commentByUser}\n\n` : ""}` +
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
    } else if (action === "ПринятьMAILRU") {
      // Менеджер нажал "ПринятьMAILRU"

      const orderData = await getOrderData(orderUnique);

      if (orderData?.status === "SUCCESS")
        return bot.sendMessage(MANAGER_CHAT_ID, "Данный заказ уже принят");

      const delay = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));

      if (orderData && orderData.im_number) {
        await delay(2000);

        const mailDeliveryData = await makeMailRuDelivery({
          "address-type-to": "DEFAULT",
          "mail-type": "ONLINE_PARCEL",
          "mail-category": "ORDINARY",
          "mail-direct": 643, // ru code in mail api
          mass: 2000,
          "index-to": Number(orderData?.index),
          "region-to": String(orderData?.region),
          "place-to": String(orderData?.cityName),
          "recipient-name": `${orderData?.surName} ${orderData?.firstName} ${orderData?.middleName}`,
          "postoffice-code": POSTOFFICE_CODE,
          "tel-address": Number(orderData?.phone),
          "order-num": orderData?.im_number,
        });

        await prisma.order.updateMany({
          where: { orderUniqueNumber: orderData?.im_number },
          data: {
            status: "SUCCESS",
            orderTrackNumber: mailDeliveryData?.orders[0]?.barcode,
          },
        });
        // --------------------------------------------------
        await bot.sendMessage(
          orderData.telegramId!,
          `Ваш заказ принят!\nВаш трек номер: ${mailDeliveryData?.orders[0]?.barcode}\n(если вместо трек номера написано undefined, обратитесь к <a href="https://t.me/ManageR_triple_h">менеджеру</a>)\n\n` +
            `Благодарим за покупку, ${orderData?.surName} ${
              orderData?.firstName
            } ${orderData?.middleName ? orderData?.middleName : ""}!\n\n` +
            `Ваш заказ:\n${orderData.products
              .map((el) => `${el.productCount} шт. | ${el.synonym}`)
              .join("\n")}\n\n` +
            `Если в течение 4х рабочих дней статус заказа не поменялся, то сообщите <a href="https://t.me/ManageR_triple_h">нам</a> об этом.\n\n` +
            `Претензии по состоянию товара и соответствию заказа рассматриваются только при наличии видео фиксации вскрытия упаковки!`,
          {
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }
        );

        const timestamp = new Date();

        const acceptOrderMessage =
          `Заказ ${
            orderData?.username
              ? `<a href="${`https://t.me/${orderData?.username}`}">клиента</a>`
              : "клиента"
          }` +
          ` принят.\n\n` +
          `Трек номер: ${mailDeliveryData?.orders[0]?.barcode}` +
          `\n\nПеречень заказа:\n` +
          `${orderData.products
            .map((el) => `${el.productCount} шт. | ${el.synonym}`)
            .join("\n")}\n\nПрайс: ${orderData?.totalPrice}\n\n` +
          `Данные клиента:\n` +
          `${orderData?.surName} ${orderData?.firstName} ${
            orderData?.middleName ? orderData?.middleName : ""
          }\nГород: ${orderData?.cityName}\n` +
          `Номер: ${orderData?.phone?.replace(/[ ()-]/g, "")}\n\n` +
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

        await bot.editMessageCaption(acceptOrderMessage, {
          chat_id: chatId!,
          message_id: messageId!,
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
        });

        // Отправка сообщения в ПОЧТА группу
        await bot.sendMessage(
          MAIL_GROUP_ID,
          `Заказ ${
            orderData?.username
              ? `<a href="${`https://t.me/${orderData?.username}`}">клиента</a>`
              : "клиента"
          }` +
            ` принят.\n\n` +
            `Трек номер: ${mailDeliveryData?.orders[0]?.barcode}` +
            `\n\nПеречень заказа:\n${orderData.products
              .map((el) => `${el.productCount} шт. | ${el.synonym}`)
              .join("\n")}\nК\nПрайс: ${
              orderData?.totalPrice
            }\nОплачено за доставку: ${orderData?.deliveryCost}\n\n` +
            `Данные клиента:\n` +
            `${orderData?.surName} ${orderData?.firstName} ${
              orderData?.middleName ? orderData?.middleName : ""
            }` +
            `\nСтрана: ${
              orderData?.country === "RU"
                ? "Россия"
                : orderData?.country === "KG"
                  ? "Кыргызстан"
                  : orderData?.country === "BY"
                    ? "Беларусь"
                    : orderData?.country === "AM"
                      ? "Армения"
                      : orderData?.country === "KZ"
                        ? "Казахстан"
                        : orderData?.country === "AZ"
                          ? "Азербайджан"
                          : orderData?.country === "UZ"
                            ? "Узбекистан"
                            : "Неизвестная страна"
            }` +
            `\nРегион: ${orderData?.region}` +
            `\nГород: ${orderData?.cityName}` +
            `\nАдрес: ${orderData?.pvzCode}` +
            `\nИндекс: ${orderData?.index}` +
            `\n\nНомер: ${orderData?.phone?.replace(/[ ()-]/g, "")}\n\n` +
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
                    callback_data: `collect_order:${mailDeliveryData?.orders[0]?.barcode}`,
                  },
                ],
                [
                  {
                    text: "Отредактировать",
                    url: `${WEB_CRM_APP}/orderedit/${mailDeliveryData?.orders[0]?.barcode}`,
                  },
                ],
              ],
            },
          }
        );

        // await bot
        //     .sendPhoto(CRYPTO_CHECKS_GROUP_ID, orderData?.fileId!, {
        //         caption: `Чек от ${
        //             orderData?.username
        //                 ? `<a href="${`https://t.me/${orderData?.username}`}">клиента</a>`
        //                 : "клиента"
        //         }`,
        //         parse_mode: "HTML",
        //     })
        //     .catch((err) => console.log(err));
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
          .sendMessage(user?.telegramId, "К сожалению ваш заказ был удалён")
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
          .deleteMessage(user?.telegramId, Number(keyboard?.messageId))
          .catch((err) => console.log(err));
        await prisma.keyboard.delete({
          where: { keyboardId: keyboard?.keyboardId },
        });
      }
    }

    // Закрываем callback
    await bot.answerCallbackQuery(query.id).catch((err) => console.log(err));
  } catch (err) {
    console.error("Ошибка обработки заказа:", err);
  }
};

// Обработчик callback_query при order collect
bot.on("callback_query", handleCollectOrder);

process.on("unhandledRejection", (reason, p) => {
  console.warn("Unhandled Rejection at:", p, "reason:", reason);
});

bot.on("callback_query", handleCallbackQuery);

app.post("/update-payment-info", updatePaymentInfo);
app.use("/order", orderRoutes);
app.use("/mail-delivery", mailRoutes);

app.use("/mailing", mailingRoutes); // При рассылке через crm

app.listen(7000, () => {
  console.log("Запущен на 7000 порте");
});
