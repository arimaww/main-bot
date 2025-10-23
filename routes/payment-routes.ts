import { Router } from "express";
import { tPaymentHandler } from "../controllers/payment-controller";

const router = Router()

router.post('/tpay', tPaymentHandler)

export { router as paymentRoutes }