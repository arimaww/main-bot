import { config } from 'dotenv'
config()
import TelegramBot from "node-telegram-bot-api";
import { prisma } from './prisma/prisma-client';
import express, { Request, Response } from 'express'
import morgan from 'morgan';
import { getOrderObjInternation, getOrderObjRu, getOrderTrackNumber, getToken, makeTrackNumber, recordOrderInfo } from './helpers/helpers';
import { TProduct, TWeb } from './types/types';
import cors from 'cors'
import { Order } from '@prisma/client';


const token = process.env.TOKEN!;
const WEB_APP = process.env.WEB_APP!;
const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID!;

const app = express()

const bot = new TelegramBot(token, { polling: true })


app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(morgan('dev'))
app.options("*", cors())


const updatingOrdersKeyboard = (orders: Order[], msg: TelegramBot.Message, text: string) => {
    const seen = new Set();
    const uniqueOrders = orders.filter(order => {
        const key = `${order.orderUniqueNumber}-${order.orderUniqueNumber}`;
        const duplicate = seen.has(key);
        seen.add(key);
        return !duplicate;
    });

    const unAcceptedOrders = `Непринятые заказы (${uniqueOrders.length})`
    bot.sendMessage(MANAGER_CHAT_ID, text, {
        reply_markup: {
            keyboard: [
                [{ text: unAcceptedOrders }]
            ],
            resize_keyboard: true
        }
    })
}

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    const isUserDidOrder = await prisma.order.findFirst({ where: { status: "WAITPAY" } })
    if (msg.text === "/start" && !isUserDidOrder) {
        const user = await prisma.user.findFirst({ where: { telegramId: msg.chat.id.toString() } })

        if (!user) {
            await prisma.user.create({
                data: {
                    telegramId: msg.chat.id.toString(),
                    userName: msg.chat.username?.toString() || "",
                }
            })
        }

        bot.sendMessage(chatId, "Чтобы сделать заказ нажмите на кнопку снизу", {
            reply_markup: {

                inline_keyboard: [
                    [{ text: "Открыть каталог", web_app: { url: WEB_APP } }]
                ]
            }
        })
    }



    const orders = await prisma.order.findMany({ where: { status: "PENDING" } })
    const seen = new Set();
    const uniqueOrders = orders.filter(order => {
        const key = `${order.orderUniqueNumber}-${order.orderUniqueNumber}`; // Используем id для уникальности
        const duplicate = seen.has(key);
        seen.add(key);
        return !duplicate;
    });

    const unAcceptedOrders = `Непринятые заказы (${uniqueOrders.length})`;

    if (msg.text === "/orders") {

        // добавление для менеджера кнопки списка всех неподтвержденных заказов
        if (chatId.toString() === MANAGER_CHAT_ID) {
            updatingOrdersKeyboard(orders, msg, "Список обновлён")
        }

    }
    if (msg.text == unAcceptedOrders && chatId.toString() === MANAGER_CHAT_ID) {
        const seen = new Set();
        const uniqueOrders = orders.filter(order => {
            const duplicate = seen.has(order.orderUniqueNumber);
            seen.add(order.orderUniqueNumber);
            return !duplicate;
        });

        uniqueOrders.map(async ord => {
            if (ord.fileId) {
                const productList = await prisma.product.findMany()
                const orderList = await prisma.order.findMany({ where: { orderUniqueNumber: ord?.orderUniqueNumber } })


                const combinedOrderData = orderList.map(order => {
                    const product = productList.find(prod => prod.productId === order.productId);
                    return {
                        productName: product?.name,
                        synonym: product?.synonym,
                        productCount: order.productCount,
                        deliverySum: 0,
                    };
                });

                const user = await prisma.user?.findFirst({ where: { userId: ord?.userId } })

                const messageToManager = `${msg.chat.username ? `<a href='https://t.me/${user?.userName}'>Пользователь</a>` : "Пользователь"}` + ` сделал заказ:\n${combinedOrderData.filter(el => el.productCount > 0)
                    .map((el) => `${el.productCount} шт. | ${el.synonym}`)
                    .join("\n")}\n\n\nФИО: ${ord?.surName} ${ord?.firstName} ${ord?.middleName}\nНомер: ${ord?.phone}\nДоставка: ${ord?.deliveryCost} ₽`




                await bot.sendPhoto(MANAGER_CHAT_ID, ord.fileId, {
                    caption: messageToManager,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ Принять", callback_data: `Принять_${ord?.orderUniqueNumber}` }, { text: "❌ Удалить", callback_data: `Удалить_${ord?.orderUniqueNumber}` }]
                        ]
                    },
                    parse_mode: "HTML"
                });
            }
        })
    }
})


app.post("/", async (req: Request<{}, {}, TWeb>, res: Response) => {
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
        deliverySum,
        bank
    } = req.body;

    let errorOrderCreating = null;

    try {
        const user = await prisma.user.findFirst({
            where: { telegramId: telegramId.toString() },
        });

        const isUserDidOrder = await prisma.order.findFirst({ where: { status: "WAITPAY", userId: user?.userId } })

        if (isUserDidOrder) {
            bot.sendMessage(telegramId, "У вас есть неоплаченный заказ")
            return res.status(400).json({ message: "Ожидание оплаты предыдущего заказа" })
        }

        if (!basket || !queryId || !totalPrice) {
            await bot.answerWebAppQuery(queryId, {
                type: "article",
                id: queryId,
                title: "Не удалось приобрести товар",
                input_message_content: {
                    message_text: "Не удалось приобрести товар\nНажмите /start и попробуйте позже",
                },
            });
            return res
                .status(400)
                .json({ message: "Все поля обязательны для заполнения" });
        }




        const uniqueProducts = products.filter((prod) => prod.productCount > 0);

        const orderId = uuid;


        const bankId = await prisma.bank.findFirst({ where: { bankName: bank } }).then(el => el?.id)

        if (bankId) {
            for (let prod of uniqueProducts) {
                await recordOrderInfo({
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
                    selectedCountry: selectedCountry
                });
            }
        }


        const handleScreenshotMessage = async (msg: TelegramBot.Message) => {
            if (msg.chat.id === telegramId) {
                if (msg.photo) {
                    const fileId = msg.photo[msg.photo.length - 1].file_id;

                    const user = await prisma.user.findFirst({ where: { telegramId: msg.chat.id.toString() } })

                    await prisma.order.updateMany({ where: { userId: user?.userId, orderUniqueNumber: orderId }, data: { fileId: fileId } })

                    try {

                        const messageToManager = `${msg.chat.username ? `<a href='https://t.me/${msg.chat.username}'>Пользователь</a>` : "Пользователь"}` + ` сделал заказ:\n${products.filter(el => el.productCount > 0)
                            .map((el) => `${el.productCount} шт. | ${el.synonym}`)
                            .join("\n")}\n\n\nФИО: ${surName} ${firstName} ${middleName}\nНомер: ${phone}\nДоставка: ${deliverySum} ₽`


                        const order = await prisma.order.findFirst({
                            where: { orderUniqueNumber: orderId },
                        });

                        const orderList = await prisma.order.findMany();
                        updatingOrdersKeyboard(orderList, msg, "Поступил новый заказ")


                        if (order && order.status === "WAITPAY") {
                            await bot.sendPhoto(MANAGER_CHAT_ID, fileId, {
                                caption: messageToManager,
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: "✅ Принять", callback_data: `Принять_${orderId}` }, { text: "❌ Удалить", callback_data: `Удалить_${orderId}` }]
                                    ]
                                },
                                parse_mode: "HTML"
                            });
                        } else {
                            console.log("Этот заказ уже обработан или отправлен.");
                        }


                        // Обработчик callback_query для кнопок "Принять" и "Удалить"

                        await prisma.order.updateMany({ where: { orderUniqueNumber: orderId }, data: { status: "PENDING" } })

                        bot.sendMessage(telegramId, "Спасибо! Ваш скриншот принят.\n\nОжидайте подтверждения заказа нашим менеджером.");

                        bot.removeListener("message", handleScreenshotMessage);
                    } catch (err) {
                        console.error('Ошибка отправки сообщения:', err);
                    }
                } else {
                    bot.sendMessage(telegramId, "Пожалуйста, прикрепите скриншот чека, а не текстовое сообщение.");
                }
            }
        };





        await bot.answerWebAppQuery(queryId, {
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
                    "\nНомер " + phone +
                    `\n\nДоставка: ${deliverySum} ₽` +
                    "\n\nПрайс: " + totalPrice,
            },
        });

        const bankData = await prisma.bank.findFirst({ where: { bankName: bank } })



        selectedCountry !== "RU" ?
            await bot.sendMessage(telegramId, `К опалте: ${totalPrice+Number(deliverySum)} ₽\n\nЕсли вы не с РФ, то просто переведите рубли на вашу валюту по актуальному курсу\n\nБанк: ${bankData?.bankName}\nПолучатель: ${bankData?.recipient}\n\n`
                + `Пожалуйста, прикрепите скриншот чека для завершения заказа.`)
            :
            await bot.sendMessage(telegramId, `К опалте: ${totalPrice} ₽\n\nБанк: ${bankData?.bankName}\nПолучатель: ${bankData?.recipient}\n\n`
                + `Пожалуйста, прикрепите скриншот чека для завершения заказа.`)

        bot.on("message", handleScreenshotMessage);

        await prisma.basket.deleteMany({ where: { userId: user?.userId } });
        return res.status(200).json({ message: "Заказ успешно оформлен" });


    } catch (err) {
        console.error("Ошибка в процессе выполнения:", err);
        return res.status(500).json({ message: "Внутренняя ошибка сервера" });
    }
});


async function getOrderData(orderId: string) {
    // Предполагаем, что данные заказов хранятся в базе данных
    const order = await prisma.order.findFirst({
        where: { orderUniqueNumber: orderId },
    });


    const entireOrders = await prisma.order.findMany({
        where: { orderUniqueNumber: orderId },
    })

    if (!order) {
        throw new Error("Заказ не найден");
    }

    const user = await prisma.user.findFirst({ where: { userId: order?.userId } })

    const products = await prisma.product.findMany();

    const orderProds: TProduct[] = []

    for (const order of entireOrders) {
        products.map((prod) => {
            if (prod.productId === order.productId && order.productCount > 0) {
                orderProds.push({
                    cost: Number(prod.cost),
                    count: prod.count,
                    productId: 0,
                    name: prod.name,
                    synonym: prod.synonym || '',
                    description: prod.description,
                    picture: prod.picture || '',
                    productCount: order.productCount,
                })
            }
        })
    }

    return {
        telegramId: user?.telegramId,
        trackNumber: order?.orderTrackNumber,
        im_number: order?.orderUniqueNumber,
        products: orderProds,
        surName: order?.surName,
        firstName: order?.firstName,
        middleName: order?.middleName,
        phone: order?.phone,
        selectedPvzCode: order?.selectedPvzCode,
        selectedTariff: order?.selectedTariff,
        totalPrice: order?.totalPrice,
        deliveryCost: order?.deliveryCost,
        username: user?.userName,
        selectedCountry: order?.selectedCountry
    };
}

const handleCallbackQuery = async (query: TelegramBot.CallbackQuery) => {
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;

    if (!query.data) {
        console.error("Отсутствует callback_data");
        return;
    }
    const [action, orderUnique] = query.data.split("_");

    try {

        if (action === "Принять") {
            // Менеджер нажал "Принять"

            const authData = await getToken({ grant_type: 'client_credentials', client_id: process.env.CLIENT_ID!, client_secret: process.env.CLIENT_SECRET! })

            // выполнение заказа и получение трек номера

            const orderData = await getOrderData(orderUnique);

            
            const getobj = orderData?.selectedCountry === "RU" ? await getOrderObjRu(authData?.access_token, orderUnique, orderData?.totalPrice, orderData?.surName!, orderData?.firstName!,
                orderData?.middleName!, orderData?.phone!, orderData?.selectedPvzCode!, orderData.deliveryCost!, orderData?.selectedTariff!)
                :
                await getOrderObjInternation(authData?.access_token, orderUnique, orderData?.totalPrice, orderData?.surName!, orderData?.firstName!,
                    orderData?.middleName!, orderData?.phone!, orderData?.selectedPvzCode!, orderData.deliveryCost!, orderData?.selectedTariff!)

            const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

            await makeTrackNumber(getobj)

            if (orderData && orderData.im_number) {

                await delay(2000);

                const orderTrackNumberForUser = await getOrderTrackNumber(orderData?.im_number, authData?.access_token!)

                await prisma.order.updateMany({
                    where: { orderUniqueNumber: orderData?.im_number },
                    data: { status: "SUCCESS", orderTrackNumber: orderTrackNumberForUser }
                })
                // --------------------------------------------------
                await bot.sendMessage(orderData.telegramId!, `Ваш заказ принят!\nВот трек-номер: ${orderTrackNumberForUser}\n\n` +
                    `Благодарим за покупку, ${orderData?.surName} ${orderData?.firstName} ${orderData?.middleName ? orderData.middleName[0] : ''}.!\n\n` +
                    `Ваш заказ:\n${orderData.products.map(el => `${el.productCount} шт. | ${el.synonym}`).join("\n")}\n\n` +
                    `Сроки доставки по РФ ориентировочно 5-7 дней.\n\nОтправка посылки осуществляется в течение 3х дней после оплаты (кроме праздничных дней и воскресения).\n\n` +
                    `Если в течение 3х дней статус заказа не изменился, сообщите <a href="https://t.me/ManageR_triple_h">нам</a> об этом.\n\n` +
                    `Претензии по состоянию товара и соответствию заказа рассматриваются только при наличии видео фиксации вскрытия упаковки!`,
                    {
                        parse_mode: 'HTML',
                        disable_web_page_preview: true,
                    });

                const timestamp = new Date();


                await bot.deleteMessage(chatId!, messageId!);

                await bot.sendMessage(chatId!, `Заказ ${orderData?.username ? `<a href="${`https://t.me/${orderData?.username}`}">клиента</a>` : 'клиента'}` + ` принят.\n\nТрек-номер: ${orderTrackNumberForUser} \n\nПеречень заказа:\n${orderData.products.map(el => `${el.productCount} шт. | ${el.synonym}`).join("\n")}\n\nОбщ. прайс: ${orderData?.totalPrice}\n\n\nДанные клиента:\n` +
                    `${orderData?.surName} ${orderData?.firstName} ${orderData?.middleName}\n\n` +
                    `Время: ${timestamp.getDate()}.${timestamp.getMonth() + 1 < 10 ? '0' + (timestamp.getMonth() + 1) : (timestamp.getMonth() + 1)}.` +
                    `${timestamp.getFullYear()}  ${timestamp.getHours() < 10 ? '0' + timestamp.getHours() : timestamp.getHours()}:` +
                    `${timestamp.getMinutes() < 10 ? '0' + timestamp.getMinutes() : timestamp.getMinutes()}`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "❌ Удалить", callback_data: `Удалить_${orderUnique}` }]
                        ]
                    },
                    parse_mode: "HTML",
                    disable_web_page_preview: true
                });


                await bot.sendMessage(process.env.CDEK_GROUP_ID!, `Заказ ${orderData?.username ? `<a href="${`https://t.me/${orderData?.username}`}">клиента</a>` : 'клиента'}` + ` принят.\n\nТрек-номер: ${orderTrackNumberForUser} \n\nПеречень заказа:\n${orderData.products.map(el => `${el.productCount} шт. | ${el.synonym}`).join("\n")}\n\nОбщ. прайс: ${orderData?.totalPrice}\n\n\nДанные клиента:\n` +
                    `${orderData?.surName} ${orderData?.firstName} ${orderData?.middleName}\n\n` +
                    `Время: ${timestamp.getDate()}.${timestamp.getMonth() + 1 < 10 ? '0' + (timestamp.getMonth() + 1) : (timestamp.getMonth() + 1)}.` +
                    `${timestamp.getFullYear()}  ${timestamp.getHours() < 10 ? '0' + timestamp.getHours() : timestamp.getHours()}:` +
                    `${timestamp.getMinutes() < 10 ? '0' + timestamp.getMinutes() : timestamp.getMinutes()}`, {
                    parse_mode: "HTML",
                    disable_web_page_preview: true
                });


            }

        } else if (action === "Удалить") {
            // Действие для удаления заказа

            const order = await prisma.order.findFirst({ where: { orderUniqueNumber: orderUnique } })

            const user = await prisma.user.findFirst({ where: { userId: order?.userId } })


            await prisma.order.deleteMany({ where: { orderUniqueNumber: orderUnique } })

            if (user)
                await bot.sendMessage(user?.telegramId, "К сожалению ваш заказ был удалён")

            await bot.editMessageCaption("Заказ был удален.", {
                chat_id: chatId,
                message_id: messageId,
            });
        }

        // Закрываем callback
        await bot.answerCallbackQuery(query.id);
    } catch (err) {
        console.error("Ошибка обработки заказа:", err);
    }
}
bot.on("callback_query", handleCallbackQuery);


app.listen(7000, () => {
    console.log("Запущен на 7000 порте");
});