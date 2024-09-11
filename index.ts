import { config } from 'dotenv'
config()
import TelegramBot from "node-telegram-bot-api";
import { prisma } from './prisma/prisma-client';
import express from 'express'
import morgan from 'morgan';



const token = process.env.TOKEN!;
const WEB_APP = process.env.WEB_APP!;

const app = express()

const bot = new TelegramBot(token, { polling: true })


app.use(express.json())
app.use(express.urlencoded({extended: true}))
app.use(morgan('dev'))



bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    if (msg.text === "/start") {
        const user = await prisma.user.findFirst({where: {telegramId: msg.chat.id.toString()}})

        if(!user) {
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