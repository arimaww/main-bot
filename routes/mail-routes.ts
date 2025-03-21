import { Router } from "express";
import { handleMailRussiaDelivery } from "../controllers/mail-controller";

const router = Router();

router.post("/russia", handleMailRussiaDelivery);

export { router as mailRoutes };
