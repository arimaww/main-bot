import TelegramBot from "node-telegram-bot-api";
import { prisma } from "../prisma/prisma-client";

export async function cancelWaitPayOrders(
    bot: TelegramBot,
    handleCallbackQuery: (
        query: TelegramBot.CallbackQuery
    ) => Promise<TelegramBot.Message | undefined>
) {
    // Полученрие всех заказов со статусом WAITPAY
    const waitPayOrders = await prisma.order.findMany({
        where: { status: "WAITPAY" },
    });

    const seen = new Set();
    const uniqueOrders = waitPayOrders.filter((order) => {
        const key = `${order.orderUniqueNumber}-${order.orderUniqueNumber}`;
        const duplicate = seen.has(key);
        seen.add(key);
        return !duplicate;
    });
    for (const order of uniqueOrders) {
        const message = `Ваш заказ был отменен, так как реквизиты были изменены.`;
        const user = await prisma.user.findFirst({
            where: { userId: order?.userId! },
        });

        const keyboard = await prisma.keyboard.findFirst({
            where: { userId: user?.userId },
        });

        if (keyboard) {
            await bot
                .deleteMessage(user?.telegramId!, Number(keyboard.messageId))
                .catch((err) => console.log(err));
            await prisma.keyboard.delete({
                where: { keyboardId: keyboard.keyboardId },
            });
        }

        await bot.sendMessage(user?.telegramId!, message);
        bot.removeAllListeners();
        bot.on("callback_query", handleCallbackQuery);
        // await bot.deleteMessage(user?.telegramId!, parseInt(order?.messageId!)).catch(err => console.log(err))
        await prisma.order.deleteMany({
            where: { orderUniqueNumber: order?.orderUniqueNumber },
        });
    }
}