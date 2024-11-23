import TelegramBot from "node-telegram-bot-api";
import { token } from "../config/config";

export const bot = new TelegramBot(token, { polling: true })