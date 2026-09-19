import { Router, type IRouter } from "express";
import healthRouter from "./health";
import campaignsRouter from "./campaigns";
import deliveryRouter from "./delivery";
import governanceRouter from "./governance";
import planningRouter from "./planning";
import webinarsRouter from "./webinars";
import implementationTasksRouter from "./implementation-tasks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(campaignsRouter);
router.use(deliveryRouter);
router.use(implementationTasksRouter);
router.use(governanceRouter);
router.use(planningRouter);
router.use(webinarsRouter);

export default router;
