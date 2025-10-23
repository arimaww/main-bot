import axios from "axios";
import {
  TPayPaymentCheckRequest,
  TPayPaymentCheckResponse,
  TPayPaymentRequest,
  TPayPaymentResponse,
} from "../../types/payment/payment.types";
import { createHash } from "crypto";

export const TPayGenerate = async (
  data: TPayPaymentRequest
): Promise<TPayPaymentResponse> => {
  const resp = await axios.post<TPayPaymentResponse>(
    `${process.env.TPAY_API_URL}/Init`,
    data
  );
  return resp.data;
};

export function makeToken(params: any, password: string) {
  const obj = { ...params };

  obj.Password = password;

  const sortedKeys = Object.keys(obj).sort();

  let concat = "";
  for (const key of sortedKeys) {
    concat += String(obj[key]);
  }

  // Вычисляем SHA-256
  const hash = createHash("sha256").update(concat, "utf8").digest("hex");

  return hash;
}

export async function getPaymentStatus(
  data: TPayPaymentCheckRequest
): Promise<TPayPaymentCheckResponse> {
  const resp = await axios.post<TPayPaymentCheckResponse>(
    `${process.env.TPAY_API_URL}/GetState`,
    data
  );
  return resp.data;
}
