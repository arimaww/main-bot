import { config } from 'dotenv'
config()
import TelegramBot from "node-telegram-bot-api";


const token = process.env.TOKEN!;
const WEB_APP = process.env.WEB_APP!;

const bot = new TelegramBot(token, { polling: true })


bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    if (msg.text === "/start") {
        bot.sendMessage(chatId, "Чтобы сделать заказ нажмите на кнопку снизу", {
            reply_markup: {

                inline_keyboard: [
                    [{ text: "Открыть каталог", web_app: { url: WEB_APP } }]
                ]
            }
        })
    }

})