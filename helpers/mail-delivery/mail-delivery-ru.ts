import axios from "axios";

export type MailDelivery = {
    "address-type-to": "DEFAULT";
    "mail-type": "ONLINE_PARCEL";
    "mail-category": "ORDINARY";
    "mail-direct": number;
    "mass": number;
    "index-to": number;
    "region-to": string;
    "place-to": string;
    "street-to"?: string;
    "house-to"?: number;
    "recipient-name": string;
    "postoffice-code": string;
    "tel-address": number;
    "order-num": string;
};

const ACCESS_TOKEN = process.env.ACCESS_TOKEN
const USER_AUTH_BASIC = process.env.USER_AUTH_BASIC
const MAIL_URL = process.env.MAIL_URL

export async function makeMailRuDelivery(data: MailDelivery) {
    const response = await axios.put(
        `${MAIL_URL}/2.0/user/backlog`,
        [data],
        {
            headers: {
                "Content-Type": "application/json;charset=UTF-8",
                Authorization: `AccessToken ${ACCESS_TOKEN}`,
                "X-User-Authorization": `Basic ${USER_AUTH_BASIC}`,
            },
        }
    );

    return response?.data
}
