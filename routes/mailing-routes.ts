import { Router } from "express";
import { handleUserMailing } from "../controllers/mailing-controller";

const router = Router()


router.post('/', handleUserMailing)


export {router as mailingRoutes}