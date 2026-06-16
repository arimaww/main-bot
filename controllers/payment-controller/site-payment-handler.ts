import { Request, Response } from "express";
import { prisma } from "../../prisma/prisma-client";
import axios from "axios";
import path from "path";
import fs from "fs";
import { bot } from "../../bot/bot";
import { MANAGER_CHAT_ID } from "../../config/config";

export const sitePaymentHandler = async (req: Request, res: Response) => {
  try {
    const { uniqueId, mediaUrl } = req.body;

    if (!uniqueId || mediaUrl.length === 0) {
      return res
        .status(400)
        .json({ message: "Все поля обязательны для заполнения" });
    }

    const order = await prisma.order.findMany({
      where: { orderUniqueNumber: uniqueId },
      include: { generatedBasket: true },
    });
    if (!order) return res.status(404).json({ message: "Заказ не найден" });

    const response = await axios({
      method: "GET",
      url: mediaUrl[0]?.url,
      headers: {
        "Content-Type": "application/octet-stream",
      },
      responseType: "stream",
    });
    const fileName = `video_${Date.now()}.jpg`;
    const filePath = path.join(__dirname, fileName);

    const writer = fs.createWriteStream(filePath);

    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    const secretDiscountId = order[0]?.generatedBasket
      ? order[0]?.generatedBasket?.secretDiscountId
      : null;

    let secret;

    if (secretDiscountId) {
      secret = await prisma.secretDiscount.findFirst({
        where: { id: Number(secretDiscountId) },
      });
    }

    const user = await prisma.user.findFirst({
      where: { userId: order[0]?.userId! },
    });
    if (!user)
      return res.status(404).json({ message: "Пользователь не найден" });

    await prisma.order.updateMany({
      where: {
        userId: user?.userId,
        orderUniqueNumber: uniqueId,
      },
      data: { fileId: mediaUrl[0]?.url },
    });

    try {
      const promocode = order[0]?.promocodeId
        ? await prisma.promocodes.findFirst({
            where: { promocodeId: order[0]?.promocodeId },
          })
        : undefined;

      const isRussia = order[0]?.selectedCountry === "RU";
      const hasDiscount = !!order[0]?.totalPriceWithDiscount;
      const deliveryCost = Number(order[0]?.deliveryCost);

      const basePrice = hasDiscount
        ? Number(order[0]?.totalPriceWithDiscount)
        : Number(order[0]?.totalPrice);
      const fullPrice = basePrice + deliveryCost;

      const cdekOffice = await prisma.cdekOffice
        .findFirst({
          where: { code: String(order[0]?.selectedPvzCode) },
        })
        .catch((err) => console.log(err));

      if (!cdekOffice)
        return res.status(404).json({ message: "ПВЗ не найден" });

      // Определяем финальную сумму
      const priceToPay =
        // Если доставка не в РФ или нет наложенного платежа — платит сразу с доставкой
        !isRussia || !cdekOffice.allowed_cod ? fullPrice : basePrice;

      const paymentNote =
        !isRussia || !cdekOffice.allowed_cod
          ? "<strong>должен оплатить вместе с доставкой</strong>"
          : "<strong>должен оплатить без учета доставки</strong>";

      // Определяем текст по доставке
      const deliveryNote = order[0]?.freeDelivery
        ? "Доставка: <strong>Бесплатно</strong>"
        : cdekOffice.allowed_cod && isRussia
          ? `Доставка: ${deliveryCost} ₽`
          : "";

      const result = `Прайс: ${priceToPay} ₽ ${paymentNote}\n ${deliveryNote}`;

      const prods = await prisma.product.findMany();

      const products = order.map((el) => {
        const foundProduct = prods.find((p) => p.productId === el.productId);

        return {
          productCount: el.productCount,
          synonym: foundProduct?.synonym,
        };
      });

      const messageToManager =
        `${
          user.userName
            ? `<a href='https://t.me/${user.userName}'>Пользователь</a>`
            : "Пользователь"
        }` +
        ` сделал заказ:\n${products
          .filter((el) => el.productCount > 0)
          .map((el) => `${el.productCount} шт. | ${el.synonym}`)
          .join(
            "\n",
          )}\nTelegram ID: ${user?.telegramId}\n\nФИО: ${user?.surName} ${user?.firstName} ${user?.middleName}\nСтрана: ${
          order[0]?.selectedCountry === "RU"
            ? "Россия"
            : order[0]?.selectedCountry === "KG"
              ? "Кыргызстан"
              : order[0]?.selectedCountry === "BY"
                ? "Беларусь"
                : order[0]?.selectedCountry === "AM"
                  ? "Армения"
                  : order[0]?.selectedCountry === "KZ"
                    ? "Казахстан"
                    : order[0]?.selectedCountry === "AZ"
                      ? "Азербайджан"
                      : order[0]?.selectedCountry === "UZ"
                        ? "Узбекистан"
                        : "Неизвестная страна"
        }
                                 \nНомер: ${String(order[0]?.phone).replace(
                                   /[ ()-]/g,
                                   "",
                                   //  TODO: Указать с доставкой ли оплата или без неё
                                 )}\n` +
        `${result}` +
        `${
          secretDiscountId
            ? `<blockquote>У данного клиента скидка на ${secret?.percent} ₽. Корзина сгенерирована менеджером.</blockquote>`
            : ""
        }` +
        `${
          promocode
            ? `\n\n<blockquote>Данный пользователь использовал промокод: ${promocode?.title} на ${promocode?.percent} %</blockquote>`
            : ""
        }`;

      if (order && order[0].status === "WAITPAY") {
        await bot
          .sendPhoto(
            MANAGER_CHAT_ID,
            fs.createReadStream(filePath),
            {
              caption: messageToManager,
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "✅ Принять",
                      callback_data: `Принять_${uniqueId}`,
                    },
                    {
                      text: "❌ Удалить",
                      callback_data: `Удалить_${uniqueId}`,
                    },
                  ],
                ],
              },
              parse_mode: "HTML",
            },
            { contentType: "application/octet-stream" },
          )
          .then(async (msg) => {
            const newMessage = await prisma.messages.create({
              data: {
                bot_msg_id: String(msg.message_id),
                cdek_group_msg_id: "",
              },
            });

            await prisma.order.updateMany({
              where: { orderUniqueNumber: uniqueId },
              data: { messagesId: newMessage.id },
            });
          })
          .catch((err) => console.log(err));
      } else {
        console.log("Этот заказ уже обработан или отправлен.");
      }

      fs.unlinkSync(filePath);

      // Обработчик callback_query для кнопок "Принять" и "Удалить"

      await prisma.order.updateMany({
        where: { orderUniqueNumber: uniqueId },
        data: { status: "PENDING" },
      });

      if (secretDiscountId)
        await prisma.secretDiscount.update({
          where: { id: secretDiscountId },
          data: { type: "USED" },
        });
    } catch (err) {
      console.error("Ошибка отправки сообщения:", err);
    }

    return res
      .status(200)
      .json({ message: "Заказ отправлен на подтверждение" });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ message: "Ошибка:", err });
  }
};
