import { Request, Response } from "express";
import { prisma } from "../prisma/prisma-client";
import { handleScreenshotMessage } from "../helpers/handle-screenshot-message";
import {
    checkOrderStatus,
    removeTimerIdForOrder,
    saveTimerIdForOrder,
} from "../map-func/order-timer";
import {
    addScreenshotHandler,
    removeScreenshotHandler,
} from "../map-func/listener-time";
import { bot } from "../bot/bot";

export const handleMailRussiaDelivery = async (req: Request, res: Response) => {
    try {
        const {
            telegramId,
            surName,
            firstName,
            middleName = "",
            phone,
            basket,
            queryId,
            totalPrice,
            country = "RU", // RU - 643 Russian code on API
            city,
            pvzAddress,
            orderUniqueNumber,
            deliverySum,
            index,
            region,
            totalPriceWithDiscount,
            secretDiscountId,
            promocodeId,
            bank,
            comments,
            products,
        } = req.body;

        const user = await prisma.user.findFirst({
            where: { telegramId: String(telegramId) },
        });

        if (!queryId || !basket || !totalPrice) {
            await bot.answerWebAppQuery(queryId, {
                type: "article",
                id: queryId,
                title: "Не удалось приобрести товар",
                input_message_content: {
                    message_text:
                        "Не удалось приобрести товар\nНапишите /start и попробуйте позже",
                },
            });
            return res
                .status(400)
                .json({ message: "Все поля обязательны для заполнения" });
        }

        const uniqueProducts = products.filter(
            (prod: { productCount: number }) => prod.productCount > 0
        );

        for (let prod of uniqueProducts) {
            await prisma.order.create({
                data: {
                    userId: user?.userId!,
                    orderUniqueNumber: orderUniqueNumber,
                    productCount: prod.productCount,
                    productId: prod.productId,
                    firstName,
                    middleName,
                    surName,
                    phone: phone,
                    deliveryCost: Number(deliverySum),
                    country: country,
                    city: city,
                    pvzCode: pvzAddress,
                    totalPrice: totalPrice,
                    orderType: "MAIL",
                    index: String(index),
                    region: String(region),
                },
            });
        }

        await bot.answerWebAppQuery(queryId, {
            type: "article",
            id: queryId,
            title: "Ваш заказ",
            input_message_content: {
                message_text:
                    `\n\nЗаказ:\n${products
                        .filter((el: any) => el.productCount > 0)
                        .map(
                            (el: any) =>
                                `${el.productCount} шт. | ${el.synonym}`
                        )
                        .join("\n")}\n` +
                    `\nФИО ${surName} ${firstName} ${middleName}` +
                    "\nНомер " +
                    phone +
                    `\n\nДоставка: ${deliverySum} ₽` +
                    "\n\nПрайс: " +
                    `${totalPrice}`,
            },
        });

        const bankData = await prisma.bank.findFirst({
            where: { bankName: bank },
        });

        await bot
                  .sendMessage(
                      telegramId,
                      `К оплате: ${
                          totalPriceWithDiscount && totalPriceWithDiscount !== 0
                              ? totalPriceWithDiscount + Number(deliverySum)
                              : totalPrice + Number(deliverySum)
                      } ₽\n` +
                          `\n\nЕсли вы не с РФ, то просто переведите рубли на вашу валюту по актуальному курсу\n\n` +
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
                          `<blockquote>${bankData?.comments}</blockquote>` +
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
                          where: { orderUniqueNumber: orderUniqueNumber },
                          data: {
                              messageId: sentMessage.message_id.toString(),
                          },
                      });
                  })
                  .catch((err) => console.log(err))

        const now = new Date();
        const nextMidnight = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + 1,
            0,
            0,
            0
        );
        const timeUntilMidnight = nextMidnight.getTime() - now.getTime();

        const screenShotHander = handleScreenshotMessage(
            telegramId,
            orderUniqueNumber,
            products,
            surName,
            middleName,
            firstName,
            country,
            city,
            totalPrice,
            Number(deliverySum),
            phone,
            "MAILRU",
            totalPriceWithDiscount,
            secretDiscountId,
            promocodeId
        );

        const timerId = setTimeout(async () => {
            const order = await checkOrderStatus(orderUniqueNumber);
            if (!order?.isPaid) {
                const existingOrder = await prisma.order.findMany({
                    where: { orderUniqueNumber: orderUniqueNumber },
                });

                existingOrder?.map(
                    async (order) =>
                        await prisma.basket.create({
                            data: {
                                userId: Number(order?.userId),
                                productId: Number(order?.productId),
                                productCount: Number(order?.productCount),
                            },
                        })
                );
                await cancelOrder(orderUniqueNumber);

                removeScreenshotHandler(orderUniqueNumber);
                await bot.sendMessage(
                    user?.telegramId!,
                    "Ваш заказ был автоматически отменен из-за отсутствия оплаты.\nТовары были возвращены в корзину /start"
                );
            }
        }, timeUntilMidnight);

        saveTimerIdForOrder(orderUniqueNumber, timerId);

        async function cancelOrder(unique: string) {
            const order = await prisma.order.findFirst({
                where: { orderUniqueNumber: unique },
            });
            const orderList = await prisma.order.findMany({
                where: { orderUniqueNumber: unique },
            });

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
        }

        addScreenshotHandler(orderUniqueNumber, screenShotHander);
        // bot.on("message", screenShotHander);

        await prisma.basket.deleteMany({ where: { userId: user?.userId } });
        return res.status(200).json({ message: "Заказ успешно оформлен" });
    } catch (err) {
        console.log(err);
        return res.status(500).json({ message: "Fatal Error: " + err });
    }
};
