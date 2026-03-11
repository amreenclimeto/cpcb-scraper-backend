import express from "express";
import { searchEprNational, syncEprNational } from "../controllers/eprNational.controller.js";


const router = express.Router();


router.post("/cpcb/epr-national", syncEprNational);
router.get("/epr-national/search", searchEprNational);



export default router;
