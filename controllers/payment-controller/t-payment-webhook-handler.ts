import { Request, Response } from "express";

export const tPaymentWebhookHandler = async (req: Request, res: Response) => {
  console.log("success t-pay webhook");
  return res.status(200).json({ message: "Success" });
};
