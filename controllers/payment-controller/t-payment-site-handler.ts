import { Request, Response } from "express";
import { prisma } from "../../prisma/prisma-client";
import { TProduct } from "../../types/types";
import { makeToken, TPayGenerate } from "../../helpers/payment/t-pay";

export const tPaymentSiteHandler = async (req: Request, res: Response) => {
  const {
    selectedPvzCode,
    selectedTariff,
    telegramId,
    basket,
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
    gbasketId,
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

    const uniqueProducts = products.filter(
      (prod: TProduct) => prod.productCount > 0,
    );

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
            gbasketId,
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
      NotificationURL: `${process.env.NOTIFICATION_URL}/site`,
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
    const payment = await prisma.paymentInfo.create({
      data: {
        amount: Number(toPay) * 100, // Копейки
        orderUniqueNumber: uuid,
        paymentId: request.PaymentId,
        userId: user.userId,
        paymentUrl: url,
        status: "NEW",
      },
    });

    await prisma.order.updateMany({
      where: { orderUniqueNumber: uuid },
      data: { paymentInfoId: payment.id },
    });

    await prisma.basket.deleteMany({ where: { userId: user?.userId } });
    return res
      .status(200)
      .json({ paymentUrl: request.PaymentURL, paymentId: request.PaymentId });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ message: "Ошибка:", err });
  }
};
