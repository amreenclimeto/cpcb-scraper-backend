import express from "express";
import { searchEprNational, syncEprNational } from "../controllers/eprNational.controller.js";
import { scrapeBatteryController } from "../controllers/batteryLead.controller.js";


const router = express.Router();


router.post("/cpcb/epr-national", syncEprNational);
router.get("/epr-national/search", searchEprNational);
router.get("/battery-lead", scrapeBatteryController);


export default router;
