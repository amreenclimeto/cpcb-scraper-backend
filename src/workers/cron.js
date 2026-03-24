import cron from "node-cron";
import fetchNationalDashboard from "../scraper/eprNational.scraper.js";
import { saveScrapedData, getLatestCreatedOn } from "../services/eprNational.service.js";

cron.schedule("0 14 * * *", async () => {
  console.log("🕑 Running CPCB national scrape at 2 PM...");

  const lastCreatedOn = await getLatestCreatedOn();
  console.log("📅 Scraping after:", lastCreatedOn);

  const result = await fetchNationalDashboard(lastCreatedOn);

  if (!result.success) {
    console.log("❌ Scrape failed:", result.error);
    return;
  }

  if (result.rows.length === 0) {
    console.log("✅ No new records found");
    return;
  }

  const stats = await saveScrapedData(result.rows);
  console.log("✅ Scrape done:", stats);

}, {
  timezone: "Asia/Kolkata" // ✅ India time fix
});