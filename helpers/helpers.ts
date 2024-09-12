import request from "request";
import { TRecordOrderInfo } from "../types/types";

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

export const makeRequest = (uuid: string, token: string): Promise<string> => {
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