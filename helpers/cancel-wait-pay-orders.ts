import TelegramBot from "node-telegram-bot-api";
import { prisma } from "../prisma/prisma-client";
import { handleCollectOrder } from "../callback-handlers/collect-order";
import { handleCallbackQuery, sendMessageHandler } from "..";
import { handleCheckPayment } from "../callback-handlers/check-payment";

export async function cancelWaitPayOrders(bot: TelegramBot) {
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
  const banks = await prisma.bank.findMany();
  const tPayBank = banks?.find(
    (bank) => bank.bankName === process.env.PAYMENT_METHOD_NAME
  );
  const isTPayBank = uniqueOrders?.some(
    (order) => order.bankId === tPayBank?.id
  );
  if (isTPayBank) return;

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

    await bot
      .sendMessage(user?.telegramId!, message)
      .catch((err) => console.log(err));
    bot.removeAllListeners();
    bot.on("callback_query", handleCollectOrder);
    bot.on("callback_query", handleCallbackQuery);
    bot.on("message", sendMessageHandler);
    bot.on("callback_query", handleCheckPayment);
    await prisma.order.deleteMany({
      where: { orderUniqueNumber: order?.orderUniqueNumber },
    });
  }
}
