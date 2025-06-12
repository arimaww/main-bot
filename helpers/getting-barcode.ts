import axios from "axios";

export const gettingBarcode = async (
    barcode_uuid: string,
    token: string | undefined
): Promise<{ barcode_url: string }> => {
    try {
        if (!token) throw new Error("Запрос не авторизован");
        if (!barcode_uuid) throw new Error("barcode_uuid не задан");

        const url = `${process.env.SERVER_API_URL}/barcode/${barcode_uuid}`;

        const axiosResponse = await axios.get(url, {
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
        });
        return axiosResponse.data;
    } catch (err: any) {
        if (err.response) {
            console.error("Ошибка API:", {
                status: err.response.status,
                data: err.response.data,
            });
            throw new Error(`Ошибка сервера: ${err.response.status}`);
        } else {
            console.error("Ошибка при запросе:", err.message);
            throw new Error(err.message);
        }
    }
};

export const pollForBarcode = async (barcode_uuid: string, token: string): Promise<string> => {
    const maxRetries = 10;
    const delay = 1;

    for (let i = 0; i < maxRetries; i++) {
        try {
            const barcode = await gettingBarcode(barcode_uuid, token);
            if (barcode.barcode_url) {
                return barcode.barcode_url; // Если URL найден
            }
        } catch (error) {
            console.log(`Попытка ${i + 1}: данные ещё недоступны.`);
        }
        await new Promise((resolve) => setTimeout(resolve, delay)); // Ждём перед следующей попыткой
    }

    throw new Error("Не удалось получить barcode_url в течение установленного времени.");
};