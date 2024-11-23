import { Request, Response } from "express";
import { cancelWaitPayOrders } from "../helpers/cancel-wait-pay-orders";
import { ordersKeyboardEvent } from "../events/orders-keyboard-event";
import { MANAGER_CHAT_ID, token } from "../config/config";
import { handleCallbackQuery } from "..";
import { bot } from "../bot/bot";

export const updatePaymentInfo = async (req: Request, res: Response) => {
    try {
        await cancelWaitPayOrders(bot, handleCallbackQuery);
        await bot.sendMessage(MANAGER_CHAT_ID, 'Реквизиты были изменены.\nВсе неоплаченные заказы удалены.')
        bot.on('message', (msg) => ordersKeyboardEvent(msg, bot, MANAGER_CHAT_ID))

        return res.status(200).json({ message: 'Реквизиты обновлены и заказы отменены' });
    } catch (error) {
        res.status(500).json({ message: 'Ошибка обновления реквизитов', error });
    }
}