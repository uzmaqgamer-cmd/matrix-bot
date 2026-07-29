import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard.js";
import vpsSyncRouter from "./vps-sync.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(vpsSyncRouter);

export default router;
