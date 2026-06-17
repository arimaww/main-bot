import { Request, Response } from "express";
import { prisma } from "../prisma/prisma-client";
import { TWeb } from "../types/types";

export const siteOrderController = async (
  req: Request<{}, {}, TWeb>,
  res: Response,
) => {
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
    gbasketId,
    promocodeId,
    selectedCityName,
    deliverySum,
    bank,
    totalPriceWithDiscount,
    secretDiscountId,
    address,
    commentByUser,
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

    await prisma.basket.deleteMany({ where: { userId: user?.userId } });
    return res.status(200).json({ orderId: orderId });
  } catch (err) {
    console.error("Ошибка обработки заказа:", err);
  }
};
