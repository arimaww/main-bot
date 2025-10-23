import TelegramBot from "node-telegram-bot-api";
import { prisma } from "../prisma/prisma-client";

export async function botOnStart(bot: TelegramBot, MANAGER_CHAT_ID: string) {
  const orders = await prisma.order.findMany({
    where: { status: "WAITPAY" },
  });

  const seen = new Set();
  const uniqueOrders = orders.filter((order) => {
    const key = `${order.orderUniqueNumber}-${order.orderUniqueNumber}`;
    const duplicate = seen.has(key);
    seen.add(key);
    return !duplicate;
  });
  for (const ord of orders) {
    const prod = await prisma.product.findFirst({
      where: { productId: ord.productId! },
    });

    await prisma.product.update({
      where: { productId: ord.productId! },
      data: { count: Number(prod?.count) + Number(ord.productCount) },
    });
  }
  for (const ord of uniqueOrders) {
    const user = await prisma.user.findFirst({
      where: { userId: ord?.userId! },
    });
    if (user) {
      if (!ord.messageId) return;
      await bot
        .deleteMessage(user?.telegramId!, parseInt(ord?.messageId!))
        .catch((err) => console.log(err));
      const keyboard = await prisma.keyboard.findFirst({
        where: { chatId: parseInt(user?.telegramId!) },
      });

      if (keyboard) {
        if (!keyboard?.messageId) return;
        await bot
          .deleteMessage(Number(keyboard?.chatId), Number(keyboard?.messageId))
          .catch((err) => console.log(err));
        await prisma.keyboard.delete({
          where: { keyboardId: keyboard?.keyboardId },
        });
      }

      await prisma.order.deleteMany({
        where: { orderUniqueNumber: ord?.orderUniqueNumber },
      });
    }
  }

  return await bot.sendMessage(
    MANAGER_CHAT_ID,
    "Бот был перезапущен.\nВсе неоплаченные заказы были автоматически удалены."
  );
}
