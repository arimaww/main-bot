import { Request, Response } from "express";
import { prisma } from "../prisma/prisma-client";
import { bot } from "../bot/bot";

export const handleUserMailing = async (req: Request, res: Response) => {
    try {
        const { message } = req.body;

        if (!message) {
            return res
                .status(400)
                .json({ message: "Поле сообщение обязательно к заполнению" });
        }

        const botUsers = await prisma.user.findMany();
        // Массив для сбора ошибок отправки
        const errors: Array<{ telegramId: number, error: string }> = [];

        for (const user of botUsers) {
            try {
                if(user.telegramId === '845856353') {
                    await bot.sendMessage(user.telegramId, message, {
                        parse_mode: "HTML",
                    });
                }
            } catch (err) {
                console.log(`Ошибка для пользователя ${user.telegramId}:`, err);
                // Собираем ошибку и продолжаем цикл
                errors.push({
                    telegramId: Number(user.telegramId),
                    error: "Сообщение не отправлено, проверьте правильность написания тегов"
                });
            }
        }

        if (errors.length) {
            return res.status(400).json({
                message: "Ошибка отправки для некоторых пользователей",
                details: errors,
            });
        }

        return res.status(200).json({ message: "Рассылка успешно совершена" });
    } catch (err) {
        console.log("Fatal error:", err);
        return res.status(500).json({ message: "Fatal error: " + err });
    }
};