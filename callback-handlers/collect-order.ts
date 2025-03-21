import { CallbackQuery } from "node-telegram-bot-api";
import { bot } from "../bot/bot";
import { prisma } from "../prisma/prisma-client";

export const handleCollectOrder = async (callbackQuery: CallbackQuery) => {
    const data = callbackQuery.data;

    if (!data) return;

    // Парсим данные из callback_data (например, 'collect_order:12345')
    const [action, orderTrackNumber] = data.split(":");
    switch (action) {
        case "collect_order":
            // Меняем клавиатуру на новую с подтверждением
            await bot
                .editMessageReplyMarkup(
                    {
                        inline_keyboard: [
                            [
                                {
                                    text: "Точно собрать? (Да)",
                                    callback_data: `confirm_collect:${orderTrackNumber}`,
                                }
                            ],
                            [
                                {
                                    text: "Назад",
                                    callback_data: `go_back:${orderTrackNumber}`,
                                },
                            ],
                        ],
                    },
                    {
                        chat_id: callbackQuery.message?.chat.id,
                        message_id: callbackQuery.message?.message_id,
                    }
                )
                .catch((err) => console.log(err));
            break;

        case "confirm_collect":
            // Логика подтверждения сбора заказа
            await bot
                .editMessageReplyMarkup(
                    {
                        inline_keyboard: [],
                    },
                    {
                        chat_id: callbackQuery.message?.chat.id,
                        message_id: callbackQuery.message?.message_id,
                    }
                )
                .catch((err) => console.log(err));
            const order = await prisma.order.findFirst({
                where: { orderTrackNumber: orderTrackNumber },
            });
            const user = await prisma.user.findFirst({
                where: { userId: Number(order?.userId) },
            });
            if (
                user &&
                order &&
                callbackQuery.message?.chat.id &&
                callbackQuery.message?.message_id
            ) {
                await bot
                    .editMessageText(
                            `Заказ с номером ${orderTrackNumber} был успешно собран!\n`,
                        {
                            chat_id: callbackQuery.message?.chat.id || 0,
                            message_id: callbackQuery.message?.message_id || 0,
                        }
                    )
                    .catch((err) => console.log(err));

                await bot
                    .sendMessage(
                        user.telegramId,
                        "Ваш закан успешно собран и в ближайшее время будет передан в доставку!\n" +
                            `Следующие изменения статуса отслеживайте через сайт ${order?.orderType === 'CDEK' ? '<a href="https://www.cdek.ru/ru/tracking/">СДЭК</a>' : '<a href="https://www.pochta.ru/tracking">ПОЧТА РОССИИ</a>'}  по вашему трек номеру: ${orderTrackNumber}`,
                        { parse_mode: "HTML", disable_web_page_preview: true }
                    )
                    .catch((err) => console.log(err));
            }
            break;

        // case "reject_collect":
        //     {
        //         // Логика отказа от сбора заказа
        //         await bot
        //             .editMessageReplyMarkup(
        //                 {
        //                     inline_keyboard: [], // Пустая клавиатура, чтобы скрыть ее
        //                 },
        //                 {
        //                     chat_id: callbackQuery.message?.chat.id,
        //                     message_id: callbackQuery.message?.message_id,
        //                 }
        //             )
        //             .catch((err) => console.log(err));

        //         const order = await prisma.order.findFirst({
        //             where: { orderTrackNumber: orderTrackNumber },
        //         });
        //         const user = await prisma.user.findFirst({
        //             where: { userId: Number(order?.userId) },
        //         });

        //         if (
        //             order &&
        //             user &&
        //             callbackQuery.message?.chat.id &&
        //             callbackQuery.message?.message_id
        //         ) {
        //             await prisma.order.deleteMany({
        //                 where: { orderTrackNumber: orderTrackNumber },
        //             });
        //             await bot.sendMessage(
        //                 user?.telegramId,
        //                 `Ваш заказ с трек номером: ${orderTrackNumber} был отменён.`
        //             );
        //             await bot
        //                 .editMessageText(
        //                     `Сбор заказа с номером ${orderTrackNumber} был отменён.`,
        //                     {
        //                         chat_id: callbackQuery.message?.chat.id || 0,
        //                         message_id:
        //                             callbackQuery.message?.message_id || 0,
        //                     }
        //                 )
        //                 .catch((err) => console.log(err));
        //         }
        //     }

        //     break;

        case "go_back":
            // Возврат к начальному состоянию клавиатуры
            await bot
                .editMessageReplyMarkup(
                    {
                        inline_keyboard: [
                            [
                                {
                                    text: "Собрать заказ",
                                    callback_data: `collect_order:${orderTrackNumber}`,
                                },
                            ],
                        ],
                    },
                    {
                        chat_id: callbackQuery.message?.chat.id,
                        message_id: callbackQuery.message?.message_id,
                    }
                )
                .catch((err) => console.log(err));
            break;
    }

    // Подтверждаем callback
    await bot
        .answerCallbackQuery(callbackQuery.id)
        .catch((err) => console.log(err));
};
