import {config} from 'dotenv'
config()
import TelegramBot from "node-telegram-bot-api";


const token = process.env.TOKEN!;

const bot = new TelegramBot(token, {polling: true})


bot.on('message', async (msg) => {
    // code
})