import { Router } from "express";
import { orderEdit } from "../controllers/order-controller";

const router = Router();

router.post("/order-edit", orderEdit);

export { router as orderRoutes };
