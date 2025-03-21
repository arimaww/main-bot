import TelegramBot from "node-telegram-bot-api";
import { prisma } from "../prisma/prisma-client";
import { TProduct } from "../types/types";
import { bot } from "../bot/bot";

const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID!;

export function handleScreenshotMessage(
    telegramId: number,
    orderUniqueNumber: string,
    products: TProduct[],
    surName: string,
    middleName: string,
    firstName: string,
    selectedCountry: string,
    selectedCityName: string,
    totalPrice: number,
    deliverySum: number,
    phone: string,
    type: "СДЭК" | "ПОЧТА" | "MAILRU",
    totalPriceWithDiscount: number,
    secretDiscountId: number,
    promocodeId: number,
    comments?: string,

) {
    return async function handleScreenshot(msg: TelegramBot.Message) {
        if (msg.chat.id === telegramId) {
            if (msg.photo) {
                bot.removeListener("message", handleScreenshot);

                const fileId = msg.photo[msg.photo.length - 1].file_id;

                const user = await prisma.user.findFirst({
                    where: { telegramId: msg.chat.id.toString() },
                });

                const isOrderAlreadyUpdated = await prisma.order.findMany({
                    where: { orderUniqueNumber: orderUniqueNumber },
                });

                if (isOrderAlreadyUpdated[0].fileId) return;

                await prisma.order.updateMany({
                    where: {
                        userId: user?.userId,
                        orderUniqueNumber: orderUniqueNumber,
                    },
                    data: { fileId: fileId },
                });

                try {
                    const promocode = promocodeId
                        ? await prisma.promocodes.findFirst({
                              where: { promocodeId: promocodeId },
                          })
                        : undefined;
                    const secret = secretDiscountId
                        ? await prisma.secretDiscount.findFirst({
                              where: { id: secretDiscountId },
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
                                (el) => `${el.productCount} шт. | ${el.synonym}`
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
                                     selectedCountry !== "RU" || type === 'MAILRU'
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
                        where: { orderUniqueNumber: orderUniqueNumber },
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
                                                callback_data: `Принять${type}_${orderUniqueNumber}`,
                                            },
                                            {
                                                text: "❌ Удалить",
                                                callback_data: `Удалить_${orderUniqueNumber}`,
                                            },
                                        ],
                                    ],
                                },
                                parse_mode: "HTML",
                            })
                            .then(async (msg) => {
                                const newMessage = await prisma.messages.create(
                                    {
                                        data: {
                                            bot_msg_id: String(msg.message_id),
                                            cdek_group_msg_id: "",
                                        },
                                    }
                                );

                                await prisma.order.updateMany({
                                    where: { orderUniqueNumber: orderUniqueNumber },
                                    data: { messagesId: newMessage.id },
                                });
                            })
                            .catch((err) => console.log(err));
                    } else {
                        console.log("Этот заказ уже обработан или отправлен.");
                    }

                    // Обработчик callback_query для кнопок "Принять" и "Удалить"

                    await prisma.order.updateMany({
                        where: { orderUniqueNumber: orderUniqueNumber },
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
}
