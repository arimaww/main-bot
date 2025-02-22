import { Request, Response } from "express";
import { bot } from "../bot/bot";
import { prisma } from "../prisma/prisma-client";

const cdek_group_id = process.env.CDEK_GROUP_ID;
const WEB_CRM_APP = process.env.WEB_CRM_APP;

export const orderEdit = async (req: Request, res: Response) => {
    try {
        const { orderUniqueNumber } = req.body;

        const orders = await prisma.order.findMany({
            where: { orderUniqueNumber },
            include: { product: true, OrderBarcode: true },
        });

        if(!orders[0].userId) return;

        const user = await prisma.user.findFirst({
            where: { userId: orders[0].userId },
        });

        const messages = await prisma.messages.findFirst({
            where: { id: orders[0].messagesId! },
        });

        const timestamp = new Date();

        await bot
            .editMessageText(
                `Заказ ${
                    user?.userName
                        ? `<a href="${`https://t.me/${user?.userName}`}">клиента</a>`
                        : "клиента"
                }` +
                    ` принят.\nTelegram ID: ${user?.telegramId}\n\nТрек-номер: ${orders[0].orderTrackNumber}. <a href="${orders[0].OrderBarcode?.url}">Ссылка</a>\n\nПеречень заказа:\n${orders
                        .map((el) => `${el.productCount} шт. | ${el.product?.synonym}`)
                        .join("\n")}\n\nПрайс: ${
                        orders[0]?.totalPriceWithDiscount
                            ? orders[0]?.totalPriceWithDiscount
                            : orders[0]?.totalPrice
                    }\n\n` +
                    `Данные клиента:\n` +
                    `${orders[0]?.surName} ${orders[0]?.firstName} ${orders[0]?.middleName}\nГород: ${orders[0]?.city}\n` +
                    `Номер: ${orders[0]?.phone?.replace(/[ ()-]/g, "")}\n\n` +
                    `${
                        orders[0]?.secretDiscountPercent
                            ? `<blockquote>Скидка ${orders[0]?.secretDiscountPercent} ₽ на корзину.</blockquote>`
                            : ""
                    }` +
                    `Время редактирования: ${timestamp.getDate()}.${
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
                    message_id: Number(messages?.cdek_group_msg_id),
                    chat_id: cdek_group_id,
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "Собрать заказ",
                                    callback_data: `collect_order:${orders[0].orderUniqueNumber}`,
                                },
                            ],
                            [
                                {
                                    text: "Отредактировать",
                                    url: `${WEB_CRM_APP}/orderedit/${orders[0].orderUniqueNumber}`,
                                },
                            ],
                        ],
                    },
                }
            )
            .catch(
                async (err) =>
                    await bot.sendMessage(
                        cdek_group_id!,
                        "Не удалось отредактировать заказ: " +
                            (err as any).message
                    )
            );
    } catch (err) {
        console.log(err);
    }
};
