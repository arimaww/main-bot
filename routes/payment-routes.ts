import { Router } from "express";
import {
  sitePaymentHandler,
  tPaymentHandler,
  tPaymentSiteHandler,
  tPaymentWebhookHandler,
  tPaymentWebhookSiteHandler,
} from "../controllers/payment-controller";

const router = Router();

router.post("/tpay", tPaymentHandler);
router.post("/tpaySite", tPaymentSiteHandler);
router.post("/webhook", tPaymentWebhookHandler);
router.post("/webhook/site", tPaymentWebhookSiteHandler);
router.post("/confirm", sitePaymentHandler);

export { router as paymentRoutes };
