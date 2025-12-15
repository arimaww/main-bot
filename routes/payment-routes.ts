import { Router } from "express";
import {
  tPaymentHandler,
  tPaymentWebhookHandler,
} from "../controllers/payment-controller";

const router = Router();

router.post("/tpay", tPaymentHandler);
router.post("/webhook", tPaymentWebhookHandler);

export { router as paymentRoutes };
