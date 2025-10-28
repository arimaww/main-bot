import { Request, Response } from "express";
import { cancelWaitPayOrders } from "../helpers/cancel-wait-pay-orders";
import { ordersKeyboardEvent } from "../events/orders-keyboard-event";
import { MANAGER_CHAT_ID, token } from "../config/config";
import { bot } from "../bot/bot";
import { prisma } from "../prisma/prisma-client";
import {
  getTimerIdForOrder,
  removeTimerIdForOrder,
  saveTimerIdForOrder,
} from "../map-func/order-timer";
import { makeToken, TPayGenerate } from "../helpers/payment/t-pay";

export const updatePaymentInfo = async (req: Request, res: Response) => {
  try {
    await cancelWaitPayOrders(bot);
    await bot.sendMessage(
      MANAGER_CHAT_ID,
      "Реквизиты были изменены.\nВсе неоплаченные заказы удалены."
    );
    bot.on("message", (msg) => ordersKeyboardEvent(msg, bot, MANAGER_CHAT_ID));

    return res
      .status(200)
      .json({ message: "Реквизиты обновлены и заказы отменены" });
  } catch (error) {
    res.status(500).json({ message: "Ошибка обновления реквизитов", error });
  }
};

export const tPaymentHandler = async (req: Request, res: Response) => {
  try {
    const {
      selectedPvzCode,
      selectedTariff,
      telegramId,
      basket,
      queryId,
      totalPrice,
      surName,
      firstName,
      middleName,
      phone,
      products,
      uuid,
      selectedCountry,
      promocodeId,
      selectedCityName,
      deliverySum,
      bank,
      totalPriceWithDiscount,
      secretDiscountId,
      address,
      commentByUser,
      email,
    } = req.body;

    try {
      const user = await prisma.user.findFirst({
        where: { telegramId: telegramId.toString() },
      });

      if (!user) {
        return res.status(404).json({ message: "Пользователь не найден" });
      }

      const pending = await prisma.order.findFirst({
        where: { status: "WAITPAY", userId: user.userId },
      });

      if (pending) {
        await prisma.order.deleteMany({
          where: { status: "WAITPAY", userId: user.userId },
        });
        console.log("Старый заказ удалён");
      }

      if (!basket || !queryId || !totalPrice) {
        await bot
          .answerWebAppQuery(queryId, {
            type: "article",
            id: queryId,
            title: "Не удалось приобрести товар",
            input_message_content: {
              message_text:
                "Не удалось приобрести товар\nНапишите /start и попробуйте позже",
            },
          })
          .catch((err) => console.log(err));
        return res
          .status(400)
          .json({ message: "Все поля обязательны для заполнения" });
      }

      const uniqueProducts = products.filter((prod) => prod.productCount > 0);

      const orderId = uuid;

      const bankId = await prisma.bank
        .findFirst({ where: { bankName: bank } })
        .then((el) => el?.id);
      const secret = await prisma.secretDiscount.findFirst({
        where: { id: secretDiscountId },
      });
      if (bankId) {
        for (let prod of uniqueProducts) {
          const discount = await prisma.productDiscount.findFirst({
            where: { productId: prod?.productId },
          });

          await prisma.order.create({
            data: {
              userId: user?.userId!,
              orderUniqueNumber: orderId,
              productCount: prod.productCount,
              productId: prod.productId,
              firstName,
              middleName,
              surName,
              phone: phone,
              deliveryCost: deliverySum!,
              selectedPvzCode: selectedPvzCode,
              selectedTariff: parseInt(selectedTariff),
              bankId: bankId,
              totalPrice: totalPrice,
              totalPriceWithDiscount:
                totalPriceWithDiscount &&
                totalPriceWithDiscount !== totalPrice &&
                totalPriceWithDiscount !== 0
                  ? totalPriceWithDiscount
                  : null,
              selectedCountry: selectedCountry,
              orderType: "CDEK",
              promocodeId: promocodeId,
              city: selectedCityName,
              secretDiscountPercent: secretDiscountId ? secret?.percent : null,
              productCostWithDiscount:
                Number(prod.cost) * prod.productCount -
                Number(prod.cost) *
                  Number(prod.productCount) *
                  (Number(discount?.percent) / 100),
              address: address ? address : null,
              commentByClient: commentByUser ? commentByUser : null,
              freeDelivery: basket[0]?.freeDelivery,
            },
          });
        }
      }
      const cdekOffice = await prisma.cdekOffice
        .findFirst({
          where: { code: selectedPvzCode },
        })
        .catch((err) => console.log(err));

      if (!cdekOffice) return;

      await bot
        .answerWebAppQuery(queryId, {
          type: "article",
          id: queryId,
          title: "Ваш заказ",
          input_message_content: {
            message_text:
              `\n\nЗаказ:\n${products
                .filter((el: any) => el.productCount > 0)
                .map((el: any) => `${el.productCount} шт. | ${el.synonym}`)
                .join("\n")}\n` +
              `\nФИО ${surName} ${firstName} ${middleName}` +
              "\nНомер " +
              phone +
              `\n\n${!!basket[0]?.freeDelivery ? "Доставка: Бесплатно" : `Доставка: ${deliverySum} ₽`}` +
              "\n\nПрайс: " +
              `${
                totalPriceWithDiscount && totalPriceWithDiscount !== 0
                  ? totalPriceWithDiscount
                  : totalPrice
              }`,
          },
        })
        .catch((err) => console.log(err));

      // При доставке заграницу
      let paymentInfoInter = "";

      if (totalPriceWithDiscount && totalPriceWithDiscount !== 0) {
        paymentInfoInter = `${totalPriceWithDiscount + Number(deliverySum)}`;
      } else {
        paymentInfoInter = `${totalPrice + Number(deliverySum)}`;
      }

      // При доставке в РФ
      let paymentInfoRu = "";

      if (
        totalPriceWithDiscount &&
        totalPriceWithDiscount !== 0 &&
        totalPriceWithDiscount !== totalPrice
      ) {
        if (address) {
          paymentInfoRu = `${totalPriceWithDiscount + Number(deliverySum)}`;
        } else if (cdekOffice.allowed_cod) {
          paymentInfoRu = `${totalPriceWithDiscount}`;
        } else {
          paymentInfoRu = `${totalPriceWithDiscount + Number(deliverySum)}`;
        }
      } else {
        if (address) {
          paymentInfoRu = `${totalPrice + Number(deliverySum)}`;
        } else if (cdekOffice.allowed_cod) {
          paymentInfoRu = `${totalPrice}`;
        } else {
          paymentInfoRu = `${totalPrice + Number(deliverySum)}`;
        }
      }

      const toPay = selectedCountry === "RU" ? paymentInfoRu : paymentInfoInter;

      const data = {
        TerminalKey: process.env.TERMINAL_KEY as string,
        Amount: Number(toPay) * 100,
        OrderId: uuid,
        Description: process.env.PRODUCT_NAME as string,
        NotificationURL: process.env.NOTIFICATION_URL as string,
        SuccessURL: process.env.SUCCESS_URL as string,
        FailURL: process.env.FAIL_URL as string,
      };

      const token = makeToken(data, process.env.TERMINAL_PASS as string);
      const receipt = {
        Email: email,
        Phone: phone,
        Taxation: "osn",
        Items: [
          {
            Name: process.env.PRODUCT_NAME as string,
            Price: Number(toPay) * 100,
            Quantity: 1,
            Amount: Number(toPay) * 100,
            Tax: "vat10",
          },
        ],
      };

      const request = await TPayGenerate({
        ...data,
        Token: token,
        Receipt: receipt,
      });

      const url = request.PaymentURL;

      if (!url) return;

      // Сохранение платежа в бд
      await prisma.paymentInfo.create({
        data: {
          amount: Number(toPay) * 100, // Копейки
          orderUniqueNumber: uuid,
          paymentId: request.PaymentId,
          userId: user.userId,
          status: "NEW",
        },
      });

      await bot.sendMessage(
        user?.telegramId!,
        `К оплате: ${toPay} ₽\n\n1. Нажмите на кнопку "Перейти к оплате"` +
          `\n2. Произведите оплату` +
          `\n3. Вернитесь в бота и нажмите кнопку "Проверить платёж"`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Перейти к оплате", url: url }],
              [
                {
                  text: "Проверить платёж",
                  callback_data: `checkpayment_${request.PaymentId}`,
                },
              ],
            ],
          },
        }
      );

      await prisma.basket.deleteMany({ where: { userId: user?.userId } });
      return res.status(200).json({ message: "Заказ успешно оформлен" });
    } catch (err) {
      console.error("Ошибка в процессе выполнения:", err);
      return res.status(500).json({ message: "Внутренняя ошибка сервера" });
    }
  } catch (err) {
    console.log(err);
    return res.status(500).json({ message: "Ошибка:", err });
  }
};
