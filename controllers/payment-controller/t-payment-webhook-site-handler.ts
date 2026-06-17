import { Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../../prisma/prisma-client";
import { bot } from "../../bot/bot";
import { MANAGER_CHAT_ID } from "../../config/config";
import { PAYMENT_STATUS } from "../../generated/enums";

function checkToken(body: Request["body"]) {
  const { Token, Data, Receipt, ...rest } = body;

  if (!Token) return false;

  // 1. Собираем пары ключ:значение (кроме Token, Data, Receipt)
  const params = { ...rest, Password: process.env.TERMINAL_PASS };

  // 2. Сортируем ключи по алфавиту и конкатенируем значения
  const sortedKeys = Object.keys(params).sort();
  const concatenated = sortedKeys.map((key) => String(params[key])).join("");

  // 3. SHA-256
  const hash = crypto
    .createHash("sha256")
    .update(concatenated, "utf8")
    .digest("hex");

  return hash === Token;
}

export const tPaymentWebhookSiteHandler = async (
  req: Request,
  res: Response,
) => {
  const body = req.body;

  // 1. Проверяем подпись
  if (!checkToken(body)) {
    console.warn("Invalid T-Bank webhook token", body);
    // Всё равно лучше ответить 200 OK, чтобы банк не долбил повторами,
    // но не выполнять никакой бизнес-логики
    return res.status(200).send("OK");
  }

  const { Status, OrderId, PaymentId, Amount, Success } = body;

  try {
    switch (Status) {
      case "CONFIRMED":
        // ✅ Деньги списаны и подтверждены — это финальный успех
        await handleSuccessfulPayment({
          orderId: OrderId,
          paymentId: PaymentId,
        });
        break;

      case "REJECTED":
      case "CANCELED":
      case "REVERSED":
        await updatePaymentStatus(OrderId, Status);
        break;

      default:
        console.log("Unhandled status:", Status, body);
    }

    // 2. Отвечаем строго "OK" с кодом 200
    return res.status(200).send("OK");
  } catch (err) {
    console.error("Error processing T-Bank webhook:", err);
    // Если не ответить OK — банк повторит запрос позже
    return res.status(500).send("ERROR");
  }
};

async function handleSuccessfulPayment({
  orderId,
  paymentId,
}: {
  orderId: string;
  paymentId: string;
}) {
  // Идемпотентность: проверяем, не обработан ли уже этот платёж
  const existingPaymentInfo = await prisma.paymentInfo.findFirst({
    where: { paymentId },
  });
  if (existingPaymentInfo?.status === "CONFIRMED") {
    return; // уже обработали, выходим
  }

  await prisma.order.updateMany({
    where: { orderUniqueNumber: orderId },
    data: {
      status: "SUCCESS",
      paymentInfoId: existingPaymentInfo?.id,
    },
  });

  const orders = await prisma.order.findMany({
    where: { orderUniqueNumber: orderId },
    include: { generatedBasket: true },
  });

  // Тут выдаём товар/услугу, шлём уведомление пользователю и т.д.

  const user = await prisma.user.findFirst({
    where: { userId: existingPaymentInfo?.userId },
  });
  if (!user) return console.log("User not found");

  const promocode = orders[0]?.promocodeId
    ? await prisma.promocodes.findFirst({
        where: { promocodeId: orders[0]?.promocodeId },
      })
    : undefined;

  const isRussia = orders[0]?.selectedCountry === "RU";
  const hasDiscount = !!orders[0]?.totalPriceWithDiscount;
  const deliveryCost = Number(orders[0]?.deliveryCost);

  const basePrice = hasDiscount
    ? Number(orders[0]?.totalPriceWithDiscount)
    : Number(orders[0]?.totalPrice);
  const fullPrice = basePrice + deliveryCost;

  const cdekOffice = await prisma.cdekOffice
    .findFirst({
      where: { code: String(orders[0]?.selectedPvzCode) },
    })
    .catch((err) => console.log(err));

  if (!cdekOffice) throw new Error("ПВЗ не найден");

  // Определяем финальную сумму
  const priceToPay =
    // Если доставка не в РФ или нет наложенного платежа — платит сразу с доставкой
    !isRussia || !cdekOffice.allowed_cod ? fullPrice : basePrice;

  // Определяем пояснение
  const paymentNote =
    !isRussia || !cdekOffice.allowed_cod
      ? "<strong>должен оплатить вместе с доставкой</strong>"
      : "<strong>должен оплатить без учета доставки</strong>";

  const secretDiscountId = orders[0]?.generatedBasket
    ? orders[0]?.generatedBasket?.secretDiscountId
    : null;

  let secret;

  if (secretDiscountId) {
    secret = await prisma.secretDiscount.findFirst({
      where: { id: Number(secretDiscountId) },
    });
  }

  // Определяем текст по доставке
  const deliveryNote = orders[0]?.freeDelivery
    ? "Доставка: <strong>Бесплатно</strong>"
    : cdekOffice.allowed_cod && isRussia
      ? `Доставка: ${deliveryCost} ₽`
      : "";

  const result = `Прайс: ${priceToPay} ₽ ${paymentNote}\n ${deliveryNote}`;

  const prods = await prisma.product.findMany();

  const products = orders.map((el) => {
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
      orders[0]?.selectedCountry === "RU"
        ? "Россия"
        : orders[0]?.selectedCountry === "KG"
          ? "Кыргызстан"
          : orders[0]?.selectedCountry === "BY"
            ? "Беларусь"
            : orders[0]?.selectedCountry === "AM"
              ? "Армения"
              : orders[0]?.selectedCountry === "KZ"
                ? "Казахстан"
                : orders[0]?.selectedCountry === "AZ"
                  ? "Азербайджан"
                  : orders[0]?.selectedCountry === "UZ"
                    ? "Узбекистан"
                    : "Неизвестная страна"
    }
                                 \nНомер: ${String(orders[0]?.phone).replace(
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

  await bot
    .sendMessage(MANAGER_CHAT_ID, messageToManager, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ Принять",
              callback_data: `Принять_${orderId}`,
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
    });
}

async function updatePaymentStatus(orderId: string, status: PAYMENT_STATUS) {
  const payment = await prisma.paymentInfo.findFirst({
    where: { orderUniqueNumber: orderId },
  });
  if (!payment) return console.log("PaymentInfo не найден");
  await prisma.paymentInfo.update({
    where: { id: payment.id },
    data: { status },
  });
}
