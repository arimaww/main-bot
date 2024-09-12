import request from "request";
import { TDeliveryRequest, TDeliveryResponse, TRecordOrderInfo } from "../types/types";

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

export const getOrderTrackNumber = (uuid: string, token: string): Promise<string> => {
	return new Promise((resolve, reject) => {
		const options = {
			url: `${process.env.SERVER_API_URL}/orders/info/`,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({ im_number: uuid, token: token }),
		};

		request(options, (error, _, body) => {
			if (error) {
				return reject("Ошибка при запросе к CDEK API: " + error);
			}

			let data;
			try {
				data = JSON.parse(body);
			} catch (parseError) {
				return reject("Error parsing JSON");
			}

			if (data.entity && data.entity.cdek_number) {
				return resolve(data.entity.cdek_number);
			} else if (data.requests[0].errors) {
				reject("Ошибка: " + data.requests[0].errors[0].message);
			} else {
				return reject("cdek_number not found");
			}
		});
	});
};



export const getOrderObjRu = (access_token:string | undefined, uuidCdek: string, basket:any, 
    surName: string, firstName: string, middleName: string,
    phone: string, selectedPvzCode: string, deliverySum: number, selectedTariff: number):TDeliveryRequest => {
    return {
        token: access_token,
        number: uuidCdek,
        type: 1,
        delivery_recipient_cost: {
            value: 0
        },
        delivery_recipient_cost_adv: [{
            sum: deliverySum,
            threshold: 1
        }],
        packages: [{
            number: "1",
            comment: "Упаковка",
            height: 10,
            items: [{
                ware_key: "1",
                payment: {
                    value:  0.1
                },
                name: "Товар",
                cost: Number(basket?.totalPrice),
                amount: 1,
                weight: 2000,
            }],
            length: 23,
            weight: 2000,
            width: 19
        }],
        recipient: {
            name: `${surName} ${firstName} ${middleName}`,
            phones: [{
                number: phone
            }]
        },
        sender: {
            name: "Зубаиров Заур Залбегович"
        },
        services: [{
            code: "INSURANCE",
            parameter: '0'
        }],
        tariff_code: selectedTariff,
        shipment_point: 'KIZ9',
        delivery_point: selectedPvzCode
    };
}


export const makeTrackNumber = async (body: TDeliveryRequest):Promise<TDeliveryResponse | undefined> => {
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

		request(options, (error, response, body) => {
			if (error) return console.log(error);
			let data;
			try {
				data = JSON.parse(body);
				return data;
			} catch (parseError) {
				return console.log('json parse error')
			}
		});
		return undefined;
	} catch (err) {
		console.log(err);
	}
}
