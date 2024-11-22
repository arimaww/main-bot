import { Order } from "@prisma/client";
import TelegramBot from "node-telegram-bot-api";

export const updateOrdersKeyboard = (
    orders: Order[],
    msg: TelegramBot.Message,
    text: string,
    bot: TelegramBot,
    MANAGER_CHAT_ID: string
) => {
    const seen = new Set();
    const uniqueOrders = orders.filter((order) => {
        const key = `${order.orderUniqueNumber}-${order.orderUniqueNumber}`;
        const duplicate = seen.has(key);
        seen.add(key);
        return !duplicate;
    });

    const unAcceptedOrders = `Непринятые заказы (${uniqueOrders.length})`;
    bot.sendMessage(MANAGER_CHAT_ID, text, {
        reply_markup: {
            keyboard: [[{ text: unAcceptedOrders }]],
            resize_keyboard: true,
        },
    });
};
