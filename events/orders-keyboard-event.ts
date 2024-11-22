import TelegramBot from "node-telegram-bot-api";
import { updateOrdersKeyboard } from "../helpers/update-order-keyboard";
import { prisma } from "../prisma/prisma-client";

export async function ordersKeyboardEvent(
    msg: TelegramBot.Message,
    bot: TelegramBot,
    MANAGER_CHAT_ID: string
) {
    const chatId = msg.chat.id;
    const orders = await prisma.order.findMany({
        where: { status: "PENDING" },
    });
    const seen = new Set();
    const uniqueOrders = orders.filter((order) => {
        const key = `${order.orderUniqueNumber}-${order.orderUniqueNumber}`; // Используем id для уникальности
        const duplicate = seen.has(key);
        seen.add(key);
        return !duplicate;
    });

    const unAcceptedOrders = `Непринятые заказы (${uniqueOrders.length})`;

    if (msg.text === "/orders") {
        // добавление для менеджера кнопки списка всех неподтвержденных заказов
        if (chatId.toString() === MANAGER_CHAT_ID) {
            updateOrdersKeyboard(
                orders,
                msg,
                "Список обновлён",
                bot,
                MANAGER_CHAT_ID
            );
        }
    }
    if (msg.text == unAcceptedOrders && chatId.toString() === MANAGER_CHAT_ID) {
        const seen = new Set();
        const uniqueOrders = orders.filter((order) => {
            const duplicate = seen.has(order.orderUniqueNumber);
            seen.add(order.orderUniqueNumber);
            return !duplicate;
        });

        uniqueOrders.map(async (ord) => {
            if (ord.fileId) {
                const productList = await prisma.product.findMany();
                const orderList = await prisma.order.findMany({
                    where: { orderUniqueNumber: ord?.orderUniqueNumber },
                });

                const combinedOrderData = orderList.map((order) => {
                    const product = productList.find(
                        (prod) => prod.productId === order.productId
                    );
                    return {
                        productName: product?.name,
                        synonym: product?.synonym,
                        productCount: order.productCount,
                        deliverySum: 0,
                    };
                });

                const user = await prisma.user?.findFirst({
                    where: { userId: ord?.userId! },
                });

                const messageToManager =
                    `${
                        msg.chat.username
                            ? `<a href='https://t.me/${user?.userName}'>Пользователь</a>`
                            : "Пользователь"
                    }` +
                    ` сделал заказ:\n${combinedOrderData
                        .filter((el) => el.productCount > 0)
                        .map((el) => `${el.productCount} шт. | ${el.synonym}`)
                        .join("\n")}\n\n\nФИО: ${ord?.surName} ${
                        ord?.firstName
                    } ${ord?.middleName}\nНомер: ${ord?.phone?.replace(
                        /[ ()-]/g,
                        ""
                    )}\n` +
                    `Прайс: ${
                        ord?.productCostWithDiscount
                            ? ord?.productCostWithDiscount
                            : ord?.totalPrice
                    }\nДоставка: ${ord?.deliveryCost} ₽`;

                await bot.sendPhoto(MANAGER_CHAT_ID, ord.fileId, {
                    caption: messageToManager,
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "✅ Принять",
                                    callback_data: `Принять_${ord?.orderUniqueNumber}`,
                                },
                                {
                                    text: "❌ Удалить",
                                    callback_data: `Удалить_${ord?.orderUniqueNumber}`,
                                },
                            ],
                        ],
                    },
                    parse_mode: "HTML",
                });
            }
        });
    }
}
