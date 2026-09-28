import { CallbackQuery } from "node-telegram-bot-api";
import { getPaymentStatus, makeToken } from "../helpers/payment/t-pay";
import { bot } from "../bot/bot";
import { prisma } from "../prisma/prisma-client";
import {
  getOrderObjInternation,
  getOrderObjRu,
  getOrderObjRuWithPrepayment,
  getOrderTrackNumber,
  getToken,
  makeTrackNumber,
} from "../helpers/helpers";
import { getOrderData } from "../helpers/get-order-data";
import { MANAGER_CHAT_ID } from "../config/config";
import { pollForBarcode } from "../helpers/getting-barcode";
import { generateBarcode } from "../helpers/generate-barcode";
import { CdekOffice } from "../generated/client";

const WEB_CRM_APP = process.env.WEB_CRM_APP as string;

export const handleCheckPayment = async (callbackQuery: CallbackQuery) => {
  const data = callbackQuery.data;
  if (!data) return;

  // Парсим данные из callback_data (например, 'checkpayment_12345')
  const [action, paymentId] = data.split("_");

  if (action === "checkpayment") {
    const data = {
      TerminalKey: process.env.TERMINAL_KEY as string,
      PaymentId: paymentId,
    };

    const token = makeToken(data, process.env.TERMINAL_PASS as string);

    const paymentInfo = await prisma.paymentInfo.findFirst({
      where: { paymentId },
    });
    if (!paymentInfo) return;

    const user = await prisma.user.findFirst({
      where: { userId: paymentInfo.userId },
    });

    if (!user) return console.log("Пользователь не найден");

    // ✅ Проверяем, не обработан ли платёж уже
    if (paymentInfo.status === "PROCESSING") {
      if (user) {
        await bot.sendMessage(
          user.telegramId,
          "Платеж ещё не подтвержден, обратитесь к менеджеру",
        );
      }
      return;
    }

    if (paymentInfo.status === "CONFIRMED") {
      const user = await prisma.user.findFirst({
        where: { userId: paymentInfo.userId },
      });
      if (user) {
        await bot.sendMessage(user.telegramId, "Заказ уже принят.");
      }
      return;
    }

    // ✅ Безопасно обновляем статус на PROCESSING
    await prisma.paymentInfo.update({
      where: { id: paymentInfo.id },
      data: { status: "PROCESSING" },
    });

    // Проверяем оплату
    const request = await getPaymentStatus({ ...data, Token: token });

    if (request.Status !== "CONFIRMED") {
      // Возвращаем статус в NEW, чтобы можно было проверить позже
      await prisma.paymentInfo.update({
        where: { id: paymentInfo.id },
        data: { status: "NEW" },
      });
      return await bot.sendMessage(user.telegramId, "Платёж ещё не обработан.");
    }

    const orderData = await getOrderData(paymentInfo.orderUniqueNumber);
    if (orderData.status === "SUCCESS") {
      return await bot.sendMessage(user.telegramId, "Заказ уже принят.");
    }

    const cdekOffice = await prisma.cdekOffice
      .findFirst({
        where: { code: orderData.selectedPvzCode! },
      })
      .catch((err) => console.log(err));

    if (!cdekOffice) return console.log("Не удалось найти ПВЗ");

    const sendOrderToManager = async () => {
      const order = await prisma.order.findFirst({
        where: { orderUniqueNumber: paymentInfo.orderUniqueNumber },
      });
      const orders = await prisma.order.findMany({
        where: { orderUniqueNumber: paymentInfo.orderUniqueNumber },
      });

      if (!order) return console.log("Заказ не найден");

      const promocode = order[0]?.promocodeId
        ? await prisma.promocodes.findFirst({
            where: { promocodeId: order[0]?.promocodeId },
          })
        : undefined;

      const isOrderAlreadyUpdated = await prisma.order.findMany({
        where: { orderUniqueNumber: paymentInfo.orderUniqueNumber },
      });

      if (isOrderAlreadyUpdated[0]?.fileId) return;

      const secretDiscountId = order[0]?.generatedBasket
        ? order[0]?.generatedBasket?.secretDiscountId
        : null;

      let secret;

      if (secretDiscountId) {
        secret = await prisma.secretDiscount.findFirst({
          where: { id: Number(secretDiscountId) },
        });
      }

      const isRussia = order.selectedCountry === "RU";
      const hasDiscount = !!order.totalPriceWithDiscount;
      const deliveryCost = Number(order.deliveryCost);

      const basePrice = hasDiscount
        ? order.totalPriceWithDiscount
        : order.totalPrice;
      const fullPrice = Number(basePrice) + deliveryCost;

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
      const deliveryNote = order.freeDelivery
        ? "Доставка: <strong>Бесплатно</strong>"
        : cdekOffice.allowed_cod && isRussia
          ? `Доставка: ${deliveryCost} ₽`
          : "";

      const result = `Прайс: ${priceToPay} ₽ ${paymentNote}\n${deliveryNote}`;

      const prods = await prisma.product.findMany();

      const products = orders.map((el) => {
        const foundProduct = prods.find((p) => p.productId === el.productId);

        return {
          productCount: el.productCount,
          synonym: foundProduct?.synonym,
        };
      });

      const messageToManager =
        `T-PAY (оплачено)\nНомер в кассе для проверки: ${order.orderUniqueNumber}\n\n` +
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
          )}\nTelegram ID: ${user.telegramId}\n\nФИО: ${order.surName} ${order.firstName} ${order.middleName}\nСтрана: ${
          order.selectedCountry === "RU"
            ? "Россия"
            : order.selectedCountry === "KG"
              ? "Кыргызстан"
              : order.selectedCountry === "BY"
                ? "Беларусь"
                : order.selectedCountry === "AM"
                  ? "Армения"
                  : order.selectedCountry === "KZ"
                    ? "Казахстан"
                    : order.selectedCountry === "AZ"
                      ? "Азербайджан"
                      : order.selectedCountry === "UZ"
                        ? "Узбекистан"
                        : "Неизвестная страна"
        }
                  \nНомер: ${order.phone?.replace(
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

      if (order && order.status === "WAITPAY") {
        await bot
          .sendMessage(MANAGER_CHAT_ID, messageToManager, {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "✅ Принять",
                    callback_data: `Принять_${paymentInfo.orderUniqueNumber}`,
                  },
                  {
                    text: "❌ Удалить",
                    callback_data: `Удалить_${paymentInfo.orderUniqueNumber}`,
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
              where: { orderUniqueNumber: paymentInfo.orderUniqueNumber },
              data: { messagesId: newMessage.id },
            });
          })
          .catch((err) => console.log(err));
      } else {
        console.log("Этот заказ уже обработан или отправлен.");
      }

      // Обработчик callback_query для кнопок "Принять" и "Удалить"

      await prisma.order.updateMany({
        where: { orderUniqueNumber: paymentInfo.orderUniqueNumber },
        data: { status: "PENDING" },
      });

      if (secretDiscountId)
        await prisma.secretDiscount.update({
          where: { id: secretDiscountId },
          data: { type: "USED" },
        });
      bot.sendMessage(
        user.telegramId,
        "Отлично, оплата прошла успешно! Мы проверим заказ и вышлем трек-номер",
      );
    };

    if (request.Status === "CONFIRMED") {
      // После всей логики заказа
      await prisma.paymentInfo.update({
        where: { id: paymentInfo.id },
        data: { status: "CONFIRMED" },
      });

      // Формирование трек номера СДЭК для заказа пользователя

      const authData = await getToken({
        grant_type: "client_credentials",
        client_id: process.env.CLIENT_ID!,
        client_secret: process.env.CLIENT_SECRET!,
      });

      if (!user.telegramId) return console.log("user chat id не найден");

      if (!orderData?.selectedPvzCode && !orderData?.address) {
        return await bot.sendMessage(
          user.telegramId,
          "selectedPvzCode не найден",
        );
      }

      let cdekOffice: CdekOffice | null = null;

      const cityRecordPromise = prisma.cdekOffice.findFirst({
        where: { City: orderData.cityName! },
      });

      const cityRecord = await cityRecordPromise.catch((err) => {
        console.error("Ошибка при cityCode:", err);
        return null;
      });
      const cityCode = cityRecord?.cityCode;

      if (!orderData.address) {
        cdekOffice = await prisma.cdekOffice
          .findFirst({
            where: {
              City: orderData.cityName!,
              code: orderData.selectedPvzCode as string,
            },
          })
          .catch((err) => {
            console.error("Ошибка при поиске cdekOffice:", err);
            return null;
          });

        if (!cdekOffice) {
          return await bot.sendMessage(user.telegramId, "cdekOffice не найден");
        }
      }

      const isRussian = orderData?.selectedCountry === "RU";
      const allowedCod = isRussian ? Boolean(cdekOffice?.allowed_cod) : false;

      let getOrderObject;

      if (isRussian) {
        if (allowedCod) {
          getOrderObject = await getOrderObjRu(
            authData?.access_token!,
            paymentInfo.orderUniqueNumber,
            orderData.totalPrice!,
            orderData.surName!,
            orderData.firstName!,
            orderData.middleName!,
            orderData.phone!,
            orderData.selectedPvzCode!,
            orderData.deliveryCost!,
            orderData.selectedTariff!,
            orderData.address!,
            cityCode!,
            orderData?.freeDelivery,
            orderData?.products,
          );
        } else {
          getOrderObject = await getOrderObjRuWithPrepayment(
            authData?.access_token!,
            paymentInfo.orderUniqueNumber,
            orderData.totalPrice!,
            orderData.surName!,
            orderData.firstName!,
            orderData.middleName!,
            orderData.phone!,
            orderData.selectedPvzCode!,
            orderData.selectedTariff!,
            orderData.address!,
            cityCode!,
            orderData?.products,
          );
        }
      } else {
        getOrderObject = await getOrderObjInternation(
          authData?.access_token!,
          paymentInfo.orderUniqueNumber,
          orderData.totalPrice!,
          orderData.surName!,
          orderData.firstName!,
          orderData.middleName!,
          orderData.phone!,
          orderData.selectedPvzCode!,
          orderData.selectedTariff!,
          orderData.address!,
          cityCode!,
          orderData?.products,
        );
      }
      const delay = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));

      await makeTrackNumber(getOrderObject);

      if (orderData && orderData.im_number) {
        await delay(3000);

        const orderCdekData = await getOrderTrackNumber(
          orderData?.im_number,
          authData?.access_token!,
        ).then((order) => order.entity);

        const orderTrackNumberForUser = orderCdekData.cdek_number;

        // Если cdek_number не придет, то отправляем заказ менеджеру

        if (!orderTrackNumberForUser) {
          return await sendOrderToManager();
        }

        await prisma.order.updateMany({
          where: { orderUniqueNumber: orderData?.im_number },
          data: {
            status: "SUCCESS",
            orderTrackNumber: orderTrackNumberForUser,
          },
        });
        // -----------------------------------------------------

        // Отправляем пользователю трек номер

        await bot
          .sendMessage(
            orderData.telegramId!,
            `🎉 <strong>Ваш заказ оформлен!</strong>\n\n📦 Трек-номер: ${orderTrackNumberForUser}\n\n` +
              `Благодарим за доверие, ${orderData?.surName} ${orderData?.firstName} ${orderData?.middleName}! Рады помогать Вам на пути к лучшему самочувствию)\n\n` +
              `Ваш заказ:\n${orderData.products
                .map((el) => `${el.productCount} шт. | ${el.synonym}`)
                .join("\n")}\n\n` +
              `⏳ Отправка в течении 2-3х дней после оформления. Магазин работает ежедневно, но отправки не осуществляются по воскресеньям и праздничным дням.\n\n` +
              `📍 Если в течение 3х дней статус заказа не изменился, сообщите <a href="https://t.me/ManageR_triple_h">нам</a>.\n\n` +
              `📦 <strong>Важная информация</strong>` +
              `\n\nЕсли нужно продлить срок хранения или изменить данные заказа (получатель, адрес, город получения) — сообщите нам заранее.` +
              `\n\nЕсли посылка возвращается из-за окончания срока хранения или отказа от получения, СДЭК удерживает стоимость доставки туда и обратно. Эти расходы компенсируются клиентом.` +
              `\n\n<strong>⚠️ При получении посылки</strong>` +
              `\n🎥 Откройте посылку в ПВЗ и снимите непрерывное видео <strong>вскрытия</strong> от запечатанной упаковки до проверки содержимого.` +
              `\n\n• Если посылка не ваша — не забирайте её и сообщите сотруднику ПВЗ.` +
              `\n• Если есть недостача, <strong>повреждение или ошибка в заказе —</strong> оформите претензию в ПВЗ, заберите посылку и напишите нам.` +
              `\n\n❗️Видео вскрытия обязательно для рассмотрения претензий.` +
              `\n\n<strong>📢 Наши каналы:</strong>` +
              `\n• Основной канал:\nhttps://t.me/+-XvL40v4VGEzZjgy` +
              `\n• Резервный канал (на случай потери доступа к основному):\nhttps://t.me/+N_pb4P0NOOs0ZmYy`,
            {
              parse_mode: "HTML",
              disable_web_page_preview: true,
            },
          )
          .catch((err) => console.log(err));

        // ----------------------------------

        // Отправляем менеджеру сообщение об успешном оформлении заказа пользователем
        const timestamp = new Date();

        const isRu = orderData?.selectedCountry === "RU";
        const isCourier = Boolean(orderData?.address);
        const hasDiscount = Boolean(orderData?.totalPriceWithDiscount);
        const allowedCOD = cdekOffice?.allowed_cod;

        let priceToPay: number;
        let paymentNote: string;

        if (isCourier) {
          // Курьер — учитываем доставку в платеже
          priceToPay = hasDiscount
            ? Number(orderData!.totalPriceWithDiscount) +
              Number(orderData!.deliveryCost)
            : Number(orderData!.totalPrice) + Number(orderData!.deliveryCost);
          paymentNote = "<strong>должен оплатить с учетом доставки</strong>";
        } else if (isRu) {
          // Самовывоз в РФ — учитываем allowed_cod
          if (allowedCOD) {
            priceToPay = hasDiscount
              ? Number(orderData!.totalPriceWithDiscount)
              : Number(orderData!.totalPrice);
            paymentNote = "<strong>должен оплатить без учета доставки</strong>";
          } else {
            priceToPay = hasDiscount
              ? Number(orderData!.totalPriceWithDiscount) +
                Number(orderData!.deliveryCost)
              : Number(orderData!.totalPrice) + Number(orderData!.deliveryCost);
            paymentNote = "<strong>должен оплатить вместе с доставкой</strong>";
          }
        } else {
          // Международная доставка — всегда учитываем доставку
          priceToPay = hasDiscount
            ? Number(orderData!.totalPriceWithDiscount) +
              Number(orderData!.deliveryCost)
            : Number(orderData!.totalPrice) + Number(orderData!.deliveryCost);
          paymentNote = "<strong>должен оплатить с учетом доставки</strong>";
        }
        const acceptOrderMessage =
          `T-PAY\n\nЗаказ ${
            orderData?.username
              ? `<a href="${`https://t.me/${orderData?.username}`}">клиента</a>`
              : "клиента"
          }` +
          ` принят.\nTelegram ID: ${orderData?.telegramId}\n\n` +
          `\nТрек-номер: ${orderTrackNumberForUser} \n\nПеречень заказа:\n` +
          `${orderData.products
            .map((el) => `${el.productCount} шт. | ${el.synonym}`)
            .join("\n")}\n\n` +
          `Прайс: ${priceToPay} ${paymentNote}` +
          `\nДоставка: ${orderData?.deliveryCost}\n\nДанные клиента:\n` +
          `${orderData?.surName} ${orderData?.firstName} ${orderData?.middleName}\nГород: ${orderData?.cityName}\n` +
          `Номер: ${orderData?.phone?.replace(/[ ()-]/g, "")}\n\n` +
          `${
            orderData?.secretDiscountPercent
              ? `<blockquote>У данного клиента скидка на ${orderData?.secretDiscountPercent} ₽. Корзина сгенерирована менеджером.</blockquote>`
              : ""
          }` +
          `${
            orderData?.promocode
              ? `<blockquote>Данный пользователь использовал промокод:  ${orderData?.promocode.title} на ${orderData?.promocode?.percent} %</blockquote>`
              : ""
          }` +
          `Время: ${timestamp.getDate()}.${
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
          }`;
        await bot
          .sendMessage(MANAGER_CHAT_ID, acceptOrderMessage, {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "❌ Удалить",
                    callback_data: `Удалить_${orderData?.im_number}`,
                  },
                ],
              ],
            },
            parse_mode: "HTML",
          })
          .catch(
            async (err) =>
              await bot.sendMessage(MANAGER_CHAT_ID, "[ЛОГИ]: Ошибка: " + err),
          );
        // ------------------------------------------------------------------------

        // Отправляем в группу СДЭК заказ с трек номером
        const barcode_uuid = await generateBarcode(
          orderCdekData.uuid,
          authData?.access_token,
        ).then((barcode) => barcode.entity.uuid);

        await new Promise((resolve) => setTimeout(resolve, 3000));

        const barcode_url = await pollForBarcode(
          barcode_uuid,
          authData?.access_token!,
        );

        // Записываем barcode в бд

        const barcodeId = await prisma.orderBarcode
          .create({ data: { url: barcode_url } })
          .then((el) => el.id);

        // записываем barcodeId в Order

        await prisma.order
          .updateMany({
            where: { orderUniqueNumber: orderData?.im_number },
            data: { orderBarcodeId: barcodeId },
          })
          .catch((err) => console.log(err));

        await bot
          .sendMessage(
            process.env.CDEK_GROUP_ID!,
            `T-PAY\n\nЗаказ ${
              orderData?.username
                ? `<a href="${`https://t.me/${orderData?.username}`}">клиента</a>`
                : "клиента"
            }` +
              ` принят.\nTelegram ID: ${
                orderData?.telegramId
              }\n\nТрек-номер: ${orderTrackNumberForUser}.\n <a href="${barcode_url}">Ссылка</a>\n\nПеречень заказа:\n${orderData.products
                .map((el) => `${el.productCount} шт. | ${el.synonym}`)
                .join("\n")}\n\nПрайс: ${
                orderData?.totalPriceWithDiscount
                  ? orderData?.totalPriceWithDiscount
                  : orderData?.totalPrice
              }\n\n` +
              `Данные клиента:\n` +
              `${orderData?.surName} ${orderData?.firstName} ${orderData?.middleName}\nГород: ${orderData?.cityName}\n` +
              `Номер: ${orderData?.phone?.replace(/[ ()-]/g, "")}\n\n` +
              `${
                orderData?.secretDiscountPercent
                  ? `<blockquote>Скидка ${orderData?.secretDiscountPercent} ₽ на корзину.</blockquote>`
                  : ""
              }` +
              `${
                orderData?.promocode
                  ? `<blockquote>Данный пользователь использовал промокод: <strong>${orderData?.promocode.title}</strong> на <strong>${orderData?.promocode?.percent} %</strong></blockquote>`
                  : ""
              }` +
              `${
                orderData?.commentByUser
                  ? `\nКомм. клиента: ${orderData?.commentByUser}\n\n`
                  : ""
              }` +
              `Время: ${timestamp.getDate()}.${
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
              parse_mode: "HTML",
              disable_web_page_preview: true,
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "Собрать заказ",
                      callback_data: `collect_order:${orderTrackNumberForUser}`,
                    },
                  ],
                  [
                    {
                      text: "Отредактировать",
                      url: `${WEB_CRM_APP}/orderedit/${paymentInfo.orderUniqueNumber}`,
                    },
                  ],
                ],
              },
            },
          )
          .then(async (msg) => {
            const order = await prisma.order.findFirst({
              where: { orderUniqueNumber: paymentInfo.orderUniqueNumber },
            });

            const msgs = await prisma.messages.create({
              data: {
                bot_msg_id: "",
                Order: { connect: { orderId: order?.orderId } },
                cdek_group_msg_id: String(msg.message_id),
              },
            });
            await prisma.order.updateMany({
              where: { orderUniqueNumber: paymentInfo.orderUniqueNumber },
              data: { messagesId: msgs.id },
            });
          })
          .catch((err) => console.log(err));
        // --------------------------------------------

        return;
      }
    }
  }
};
