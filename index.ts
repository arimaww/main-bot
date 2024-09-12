import { config } from 'dotenv'
config()
import TelegramBot from "node-telegram-bot-api";
import { prisma } from './prisma/prisma-client';
import express, { Request, Response } from 'express'
import morgan from 'morgan';
import { makeRequest, recordOrderInfo } from './helpers/helpers';
import { TWeb } from './types/types';
import cors from 'cors'



const token = process.env.TOKEN!;
const WEB_APP = process.env.WEB_APP!;
const MANAGER_CHAT_ID = "2127200971"

const app = express()

const bot = new TelegramBot(token, { polling: true })


app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(morgan('dev'))
app.options("*", cors())



bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    if (msg.text === "/start") {
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
})


app.post("/", async (req: Request<{}, {}, TWeb>, res: Response) => {
    const {
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
        token,
        deliverySum
    } = req.body;

    let errorOrderCreating = null;

    try {
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

        const user = await prisma.user.findFirst({
            where: { telegramId: telegramId.toString() },
        });

        await makeRequest(uuid, token).then(async trackNumber => {
            const uniqueProducts = products.filter((prod) => prod.productCount > 0);

            for (let prod of uniqueProducts) {
                await recordOrderInfo({
                    userId: user?.userId!,
                    orderTrackNumber: trackNumber!,
                    productCount: prod.productCount,
                    productId: prod.productId,
                    firstName,
                    middleName,
                    surName,
                });
            }

            const handleScreenshotMessage = (msg: TelegramBot.Message) => {
                if (msg.chat.id === telegramId) {
                    if (msg.photo) {
                        const fileId = msg.photo[msg.photo.length - 1].file_id;
            
                        try {
                            const messageToManager = `Пользователь сделал заказ:\n${products.filter(el => el.productCount > 0)
                                .map((el) => `${el.productCount} шт. | ${el.synonym}`)
                                .join("\n")}\n\nТрек-номер: ${trackNumber}\nФИО: ${surName} ${firstName} ${middleName}\nНомер: ${phone}\nДоставка: ${deliverySum} ₽`;
            
                            bot.sendPhoto(MANAGER_CHAT_ID, fileId, {
                                caption: messageToManager, // Подпись к фотографии (описание заказа)
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: "Принять", callback_data: "Принять" }, { text: "Удалить", callback_data: "Удалить" }]
                                    ]
                                }
                            });
            
                            bot.sendMessage(telegramId, "Спасибо! Ваш скриншот принят. Заказ завершен.");
            
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
                        "Трек-номер: " + trackNumber +
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


            await bot.sendMessage(telegramId, "Пожалуйста, прикрепите скриншот чека для завершения заказа.");

            bot.on("message", handleScreenshotMessage);

            await prisma.basket.deleteMany({ where: { userId: user?.userId } });
            return res.status(200).json({ message: "Заказ успешно оформлен" });

        }).catch(async err => {
            errorOrderCreating = err;
            console.log("Ошибка оформления: " + err);
            await bot.answerWebAppQuery(queryId, {
                type: "article",
                id: queryId,
                title: "Не удалось приобрести товар",
                input_message_content: { message_text: "Не удалось приобрести товар\n\n" + err },
            });
            return res.status(500).json({ message: "Не удалось приобрести товар\n\n" + err });
        });

    } catch (err) {
        console.error("Ошибка в процессе выполнения:", err);
        return res.status(500).json({ message: "Внутренняя ошибка сервера" });
    }
});


app.listen(7000, () => {
    console.log("Запущен на 7000 порте");
});