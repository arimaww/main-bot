import axios from "axios";

export const generateBarcode = async (
    order_uuid: string,
    token: string | undefined
): Promise<{ entity: { uuid: string } }> => {
    try {
        if (!token) throw new Error("Токен не был введён");
        const axiosResponse = await axios.post(
            `${process.env.SERVER_API_URL}/barcode/`,
            { order_uuid },
            {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            }
        );

        return axiosResponse.data;
    } catch (err: any) {
        throw new Error("Ошибка при запросе к CDEK API: " + err.message);
    }
};
