import dotenv from "dotenv";
import fetchNationalDashboard from "../scraper/eprNational.scraper.js";
import { saveScrapedData, getLatestCreatedOn } from "../services/eprNational.service.js";

dotenv.config();

export async function runNationalJob(job) {
  try {
    console.log("🖊 National EPR job started");

    // 🆕 DB se latest created_on lo
    const lastCreatedOn = await getLatestCreatedOn();
    console.log("📅 Scraping after:", lastCreatedOn);

    // 🆕 lastCreatedOn pass karo scraper ko
    const result = await fetchNationalDashboard(lastCreatedOn);

    if (!result.success) {
      throw new Error(result.error || "Scraping failed");
    }

    // 🆕 Koi naya record nahi mila
    if (result.rows.length === 0) {
      console.log("✅ No new records found, skipping save");
      return { inserted: 0, updated: 0, errors: 0 };
    }

    console.log(`📋 Scraped ${result.rows.length} new records, saving...`);

    const saveResult = await saveScrapedData(result.rows);

    console.log(`✅ National EPR job completed: ${saveResult.newUsers} inserted, ${saveResult.statusChanges} status changes`);

    return saveResult;

  } catch (err) {
    console.error("❌ National EPR job error:", err.message);
    console.error("❌ Error stack:", err.stack);
    throw err;
  }
}