import scrapeBatteryLead from "../scraper/batteryLead.scraper.js";
import { saveBatteryLead } from "../services/batteryLead.service.js";

export async function scrapeBatteryController(req, res) {

  try {

    const rows = await scrapeBatteryLead();

    const inserted = await saveBatteryLead(rows);

    res.json({
      status: "success",
      total: rows.length,
      inserted
    });

  } catch (err) {

    res.status(500).json({
      status: "error",
      message: err.message
    });

  }

}