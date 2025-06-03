import request from "request";
import {
    ResponseAuthData,
    TCdekUser,
    TDeliveryRequest,
    TDeliveryResponse,
    TRecordOrderInfo,
} from "../types/types";
import axios from "axios";

export const recordOrderInfo = async (body: TRecordOrderInfo) => {
    try {
        const options = {
            url: `${process.env.SERVER_API_URL}/orders/recordInfo`,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify(body),
        };

        request(options, (error, response, body) => {
            if (error) return console.log(error);
        });
    } catch (err) {
        console.log(err);
    }
};

export const getOrderTrackNumber = async (
    uuid: string,
    token: string
): Promise<{ entity: { uuid: string; cdek_number: string } }> => {
    try {
        const response = await axios.post(
            `${process.env.SERVER_API_URL}/orders/info/`,
            { im_number: uuid, token: token },
            {
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
            }
        );

        const data = response.data;

        return data;
    } catch (error: any) {
        throw new Error("Ошибка при запросе к CDEK API: " + error.message);
    }
};

export const getOrderObjRu = async (
    access_token: string | undefined,
    uuidCdek: string,
    totalPrice: any,
    surName: string,
    firstName: string,
    middleName: string,
    phone: string,
    selectedPvzCode: string,
    deliverySum: number,
    selectedTariff: number,
    address: string,
    cityCode: number,
    freeDelivery?: boolean
): Promise<TDeliveryRequest> => {
    const obj = {
        token: access_token,
        number: uuidCdek,
        type: 1,
        delivery_recipient_cost: {
            value: 0,
        },
        delivery_recipient_cost_adv: [
            {
                sum: freeDelivery ? 0 : deliverySum,
                threshold: 1,
            },
        ],
        packages: [
            {
                number: "1",
                comment: "Упаковка",
                height: 10,
                items: [
                    {
                        ware_key: "1",
                        payment: {
                            value: 1,
                        },
                        name: "Пищевые добавки",
                        cost: Number(totalPrice),
                        amount: 1,
                        weight: 1200,
                    },
                ],
                length: 30,
                weight: 1200,
                width: 20,
            },
        ],
        recipient: {
            name: `${surName} ${firstName} ${middleName}`,
            phones: [
                {
                    number: phone,
                },
            ],
        },
        sender: {
            name: "Газиев Гаджи Хизриевич",
        },
        services: [
            {
                code: "INSURANCE",
                parameter: "0",
            },
        ],
        tariff_code: selectedTariff,
        shipment_point: process.env.SHIPMENT_POINT!,
    };

    if (address) {
        const courierDelivery: TDeliveryRequest = {
            ...obj,
            to_location: { code: cityCode, address: address },
        };

        return courierDelivery;
    } else {
        const warehouseDelivery: TDeliveryRequest = {
            ...obj,
            delivery_point: selectedPvzCode,
        };
        return warehouseDelivery;
    }
};

export const getOrderObjRuWithPrepayment = async (
    access_token: string | undefined,
    uuidCdek: string,
    totalPrice: any,
    surName: string,
    firstName: string,
    middleName: string,
    phone: string,
    selectedPvzCode: string,
    deliverySum: number,
    selectedTariff: number,
    address: string,
    cityCode: number,
    freeDelivery?: boolean
): Promise<TDeliveryRequest> => {
    const obj = {
        token: access_token,
        number: uuidCdek,
        type: 1,
        delivery_recipient_cost: {
            value: 0,
        },
        packages: [
            {
                number: "1",
                comment: "Упаковка",
                height: 10,
                items: [
                    {
                        ware_key: "1",
                        payment: {
                            value: 0,
                        },
                        name: "Пищевые добавки",
                        cost: Number(totalPrice),
                        amount: 1,
                        weight: 1200,
                    },
                ],
                length: 30,
                weight: 1200,
                width: 20,
            },
        ],
        recipient: {
            name: `${surName} ${firstName} ${middleName}`,
            phones: [
                {
                    number: phone,
                },
            ],
        },
        sender: {
            name: "Газиев Гаджи Хизриевич",
        },
        services: [
            {
                code: "INSURANCE",
                parameter: "0",
            },
        ],
        tariff_code: selectedTariff,
        shipment_point: process.env.SHIPMENT_POINT!,
    };

    if (address) {
        const courierDelivery: TDeliveryRequest = {
            ...obj,
            to_location: { code: cityCode, address: address },
        };

        return courierDelivery;
    } else {
        const warehouseDelivery: TDeliveryRequest = {
            ...obj,
            delivery_point: selectedPvzCode,
        };
        return warehouseDelivery;
    }
};

export const getOrderObjInternation = async (
    access_token: string | undefined,
    uuidCdek: string,
    totalPrice: any,
    surName: string,
    firstName: string,
    middleName: string,
    phone: string,
    selectedPvzCode: string,
    deliverySum: number,
    selectedTariff: number,
    address: string,
    cityCode: number
): Promise<TDeliveryRequest> => {
    let obj = {
        token: access_token,
        number: uuidCdek,
        type: 1,
        date_invoice: `${new Date().getFullYear()}-${String(
            new Date().getMonth() + 1
        ).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`,
        shipper_address: "Старый Бавтугай, ул. Интернатская, 2",
        delivery_recipient_cost: {
            value: 0,
        },
        seller: {
            address: "Старый Бавтугай, ул. Интернатская, 2",
        },
        shipper_name: "Vorobei Shop",
        packages: [
            {
                number: "1",
                comment: "Упаковка",
                height: 10,
                items: [
                    {
                        ware_key: "1",
                        payment: {
                            value: 0,
                        },
                        name: "Пищевые добавки",
                        cost: Number(totalPrice),
                        amount: 1,
                        weight: 1200,
                        weight_gross: 1300,
                    },
                ],
                length: 30,
                weight: 1200,
                width: 20,
            },
        ],
        recipient: {
            name: `${surName} ${firstName} ${middleName}`,
            phones: [
                {
                    number: phone,
                },
            ],
        },
        sender: {
            name: "Газиев Гаджи Хизриевич",
        },
        services: [
            {
                code: "INSURANCE",
                parameter: "0",
            },
        ],
        tariff_code: selectedTariff,
        shipment_point: process.env.SHIPMENT_POINT!,
    };

    if (address) {
        const courierDelivery: TDeliveryRequest = {
            ...obj,
            to_location: { code: cityCode, address: address },
        };

        return courierDelivery;
    } else {
        const warehouseDelivery: TDeliveryRequest = {
            ...obj,
            delivery_point: selectedPvzCode,
        };
        return warehouseDelivery;
    }
};

export const makeTrackNumber = async (
    body: TDeliveryRequest
): Promise<TDeliveryResponse | undefined> => {
    try {
        const options = {
            url: `${process.env.SERVER_API_URL}/orders`,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify(body),
        };

        return new Promise((resolve, reject) => {
            request(options, (error, response, body) => {
                if (error) {
                    console.log(error);
                    reject(error);
                }

                try {
                    const data = JSON.parse(body);
                    resolve(data);
                } catch (parseError) {
                    console.log("json parse error");
                    reject(parseError);
                }
            });
        });
    } catch (err) {
        console.log(err);
        return undefined;
    }
};

export const getToken = async (
    body: TCdekUser
): Promise<ResponseAuthData | undefined> => {
    try {
        const options = {
            url: `${process.env.SERVER_API_URL}/oauth/token`,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify(body),
        };

        return new Promise((resolve, reject) => {
            request(options, (error, response, body) => {
                if (error) {
                    console.error(error);
                    reject(error);
                }
                try {
                    const data = JSON.parse(body);
                    resolve(data);
                } catch (err) {
                    console.log(err);
                    resolve(undefined);
                }
            });
        });
    } catch (err) {
        console.log(err);
        return undefined;
    }
};
