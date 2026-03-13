import cron from "node-cron";
import fetchNationalDashboard from "../scraper/eprNational.scraper.js";
import { saveScrapedData } from "../services/eprNational.service.js";

cron.schedule("0 * * * *", async () => {

  console.log("Running CPCB scrape...");

  const result = await fetchNationalDashboard();

  if (!result.success) return;

  const stats = await saveScrapedData(result.rows);

  console.log("Scrape result:", stats);

});