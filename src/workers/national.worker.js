import dotenv from "dotenv";
import fetchNationalDashboard from "../scraper/eprNational.scraper.js";
import { saveNationalEprToPG } from "../services/eprNational.service.js";

dotenv.config();

export async function runNationalJob(job) {
  try {
    console.log("🚀 National EPR job started");

    const result = await fetchNationalDashboard({ headless: true });

    if (!result.success) {
      throw new Error(result.error || "Scraping failed");
    }

    console.log(`📊 Scraped ${result.rows?.length || 0} records, now saving to database...`);

    const saveResult = await saveNationalEprToPG(result.rows);

    console.log(`✅ National EPR job completed: ${saveResult.inserted} inserted, ${saveResult.updated} updated`);
    
    if (saveResult.errors > 0) {
      console.warn(`⚠️ ${saveResult.errors} records failed to save`);
    }
  } catch (err) {
    console.error("❌ National EPR job error:", err.message);
    console.error("❌ Error stack:", err.stack);
    throw err; // Re-throw to let BullMQ handle the failure
  }
}


