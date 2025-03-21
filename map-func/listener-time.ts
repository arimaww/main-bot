import TelegramBot from "node-telegram-bot-api";
import { bot } from "../bot/bot";

export const activeMessageHandlers = new Map<string, (msg: TelegramBot.Message) => void>();


export function addScreenshotHandler(
    orderUniqueNumber: string,
    handler: (msg: TelegramBot.Message) => void
) {
    activeMessageHandlers.set(orderUniqueNumber, handler);
    bot.on("message", handler);
}

export function removeScreenshotHandler(orderUniqueNumber: string) {
    const handler = activeMessageHandlers.get(orderUniqueNumber);
    if (handler) {
        bot.removeListener("message", handler);
        activeMessageHandlers.delete(orderUniqueNumber);
    }
}