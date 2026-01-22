import { Request, Response } from "express";
import { TWeb } from "../types/types";
import { prisma } from "../prisma/prisma-client";
import { bot } from "../bot/bot";
import { MANAGER_CHAT_ID } from "../config/config";

export const abovetwentyController = async (
  req: Request<{}, {}, TWeb>,
  res: Response
) => {
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

    console.log('Телефон ', phone, " Стоимость доставки: ", deliverySum)

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
            `\n\n${
              !!basket[0]?.freeDelivery
                ? "Доставка: Бесплатно"
                : `Доставка: ${deliverySum} ₽`
            }` +
            "\n\nПрайс: " +
            `${
              totalPriceWithDiscount && totalPriceWithDiscount !== 0
                ? totalPriceWithDiscount
                : totalPrice
            }`,
        },
      })
      .catch((err) => console.log(err));

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
            status: "PENDING",
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

    if (!cdekOffice) return res.status(404).json({ message: "ПВЗ не найден" });

    try {
      const promocode = promocodeId
        ? await prisma.promocodes.findFirst({
            where: { promocodeId: promocodeId },
          })
        : undefined;

      const isRussia = selectedCountry === "RU";
      const hasDiscount = !!totalPriceWithDiscount;
      const deliveryCost = Number(deliverySum);

      const basePrice = hasDiscount ? totalPriceWithDiscount : totalPrice;
      const fullPrice = basePrice + deliveryCost;

      // Определяем финальную сумму
      const priceToPay =
        // Если доставка не в РФ или нет наложенного платежа — платит сразу с доставкой
        !isRussia || !cdekOffice.allowed_cod ? fullPrice : basePrice;
      // Определяем пояснение
      const paymentNote =
        !isRussia || !cdekOffice.allowed_cod
          ? "<strong>должен оплатить вместе с доставкой</strong>"
          : "<strong>должен оплатить без учета доставки</strong>";

      // Определяем текст по доставке
      const deliveryNote = basket[0]?.freeDelivery
        ? "Доставка: <strong>Бесплатно</strong>"
        : cdekOffice.allowed_cod && isRussia
        ? `Доставка: ${deliveryCost} ₽`
        : "";

      const result = `Прайс: ${priceToPay} ₽ ${paymentNote}\n ${deliveryNote}`;

      const messageToManager =
        `<strong>[ЗАКАЗ НЕ ОПЛАЧЕН]</strong>\n` +
        `ID заказа: ${orderId}\n\n` +
        `${
          user.userName
            ? `<a href='https://t.me/${user.userName}'>Пользователь</a>`
            : "Пользователь"
        }` +
        ` сделал заказ:\n${products
          .filter((el) => el.productCount > 0)
          .map((el) => `${el.productCount} шт. | ${el.synonym}`)
          .join(
            "\n"
          )}\n\nTelegram ID: ${telegramId}\nФИО: ${surName} ${firstName} ${middleName}\nСтрана: ${
          selectedCountry === "RU"
            ? "Россия"
            : selectedCountry === "KG"
            ? "Кыргызстан"
            : selectedCountry === "BY"
            ? "Беларусь"
            : selectedCountry === "AM"
            ? "Армения"
            : selectedCountry === "KZ"
            ? "Казахстан"
            : selectedCountry === "AZ"
            ? "Азербайджан"
            : selectedCountry === "UZ"
            ? "Узбекистан"
            : "Неизвестная страна"
        }\nНомер: ${phone.replace(/[ ()-]/g, "")}\n` +
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

      const order = await prisma.order.findFirst({
        where: { orderUniqueNumber: orderId },
      });
      if (order) {
        await bot
          .sendMessage(MANAGER_CHAT_ID, messageToManager, {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "✅ Принять",
                    callback_data: `Прин20k_${orderId}`,
                  },
                  {
                    text: "❌ Удалить",
                    callback_data: `Удалить_${orderId}`,
                  },
                ],
              ],
            },
            parse_mode: "HTML",
          })
          .then(async (msg) => {
            const newMessage = await prisma.messages.create({
              data: {
                bot_msg_id: String(msg.message_id),
                cdek_group_msg_id: "",
              },
            });

            await prisma.order.updateMany({
              where: { orderUniqueNumber: orderId },
              data: { messagesId: newMessage.id },
            });
          })
          .catch((err) => console.log(err));
      } else {
        console.log("Этот заказ уже обработан или отправлен.");
      }

      // Обработчик callback_query для кнопок "Принять" и "Удалить"
      if (secretDiscountId)
        await prisma.secretDiscount.update({
          where: { id: secretDiscountId },
          data: { type: "USED" },
        });
    } catch (err) {
      console.log("Ошибка", err);

      return res.status(500).json("Ошибка на стороне сервера.");
    }

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
    selectedCountry !== "RU"
      ? await bot
          .sendMessage(
            telegramId,
            `К оплате: ${paymentInfoInter} ₽\n\n` +
              `Номер заказа: ${orderId}\n\n` +
              `<strong>ДЛЯ ПОЛУЧЕНИЯ РЕКВИЗИТОВ ПЕРЕШЛИТЕ ДАННОЕ СООБЩЕНИЕ <a href="${process.env.MANAGER_LINK}">МЕНЕДЖЕРУ</a></strong>\n\n` +
              `1) Перешлите данное сообщение <a href="${process.env.MANAGER_LINK}">менеджеру</a>, он пришлет реквизиты для оптлаты. <a href="${process.env.MANAGER_LINK}">Жми</a> \n` +
              `2) После оплаты пришлите <a href="${process.env.MANAGER_LINK}">менеджеру</a> чек оплаты.\n` +
              `3) Дождитесь, пока <a href="${process.env.MANAGER_LINK}">менеджер</a> подтвердит ваш заказ.\n`,
            {
              parse_mode: "HTML",
              disable_web_page_preview: true,
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "ПЕРЕШЛИТЕ ДАННОЕ СООБЩЕНИЕ МЕНЕДЖЕРУ",
                      callback_data: "отмена",
                    },
                  ],
                ],
              },
            }
          )
          .then(async (sentMessage) => {
            await prisma.order.updateMany({
              where: { orderUniqueNumber: orderId },
              data: {
                messageId: sentMessage.message_id.toString(),
              },
            });
          })
          .catch((err) => console.log(err))
      : await bot
          .sendMessage(
            user?.telegramId!,
            `К оплате: ${paymentInfoRu} ₽\n\n` +
              `Номер заказа: ${orderId}\n\n` +
              `<strong>ДЛЯ ПОЛУЧЕНИЯ РЕКВИЗИТОВ ПЕРЕШЛИТЕ ДАННОЕ СООБЩЕНИЕ <a href="${process.env.MANAGER_LINK}">МЕНЕДЖЕРУ</a></strong>\n\n` +
              `1) Перешлите данное сообщение <a href="${process.env.MANAGER_LINK}">менеджеру</a>, он пришлет реквизиты для оптлаты. <a href="${process.env.MANAGER_LINK}">Жми</a> \n` +
              `2) После оплаты пришлите <a href="${process.env.MANAGER_LINK}">менеджеру</a> чек оплаты.\n` +
              `3) Дождитесь, пока <a href="${process.env.MANAGER_LINK}">менеджер</a> подтвердит ваш заказ.\n`,
            {
              parse_mode: "HTML",
              disable_web_page_preview: true,
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "ПЕРЕШЛИТЕ ДАННОЕ СООБЩЕНИЕ МЕНЕДЖЕРУ",
                      callback_data: "отмена",
                    },
                  ],
                ],
              },
            }
          )
          .then(async (sentMessage) => {
            await prisma.order
              .updateMany({
                where: { orderUniqueNumber: orderId },
                data: {
                  messageId: sentMessage.message_id.toString(),
                },
              })
              .catch((err) => console.log(err));
          });

    await prisma.basket.deleteMany({ where: { userId: user?.userId } });
    return res.status(200).json({ message: "Заказ успешно оформлен" });
  } catch (err) {
    console.error("Ошибка в процессе выполнения:", err);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
};
