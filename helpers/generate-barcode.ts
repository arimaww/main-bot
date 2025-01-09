import PDFDocument from "pdfkit";
import { bot } from "../bot/bot";
import TelegramBot from "node-telegram-bot-api";
import bwipjs from "bwip-js";

export async function generateBarcode(
    orderNumber: string,
    chatId: TelegramBot.ChatId,
    caption: string
): Promise<{ pdfBuffer: Buffer; filename: string; contentType: string } | null> {
    if (!orderNumber) {
        await bot.sendMessage(chatId, "Трек-номера к заказу не найден");
        return null;
    }

    try {
        // Генерация изображения штрихкода
        const barcodeBuffer = await bwipjs.toBuffer({
            bcid: "code128",
            text: String(orderNumber),
            scale: 2, // Уменьшите масштаб
            height: 8, // Уменьшите высоту
            includetext: true,
            textxalign: "center",
        });

        // Создание PDF в памяти
        const pdfStream = new PDFDocument();
        pdfStream.font("Helvetica");
        const chunks: Buffer[] = [];

        // Слушатели событий для записи данных
        pdfStream.on("data", (chunk) => chunks.push(chunk));

        // Завершение создания PDF
        return new Promise((resolve, reject) => {
            pdfStream.on("end", () => {
                const pdfBuffer = Buffer.concat(chunks);
                resolve({
                    pdfBuffer,
                    filename: `barcode-${orderNumber}.pdf`,
                    contentType: "application/octet-stream",
                });
            });

            pdfStream.on("error", (err) => reject(err));

            // Генерация содержимого PDF
            pdfStream
                .fontSize(16)
            pdfStream.image(barcodeBuffer, {
                fit: [200, 200],
                align: "center",
                valign: "center",
            });
            pdfStream.end();
        });
    } catch (error) {
        console.error("Ошибка генерации PDF:", error);
        await bot.sendMessage(chatId, "Произошла ошибка при создании штрихкода.");
        return null;
    }
}
