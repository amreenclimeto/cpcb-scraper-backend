import cron from "node-cron";
import { scrapeCpcbPiboData } from "../scraper/Pibo.scraper.js";

export const startPiboCron = () => {
  cron.schedule(
    "0 */2 * * *",
    async () => {
      try {
        console.log("⏰ Running PIBO scraper (every 2 hours)");

        const result = await scrapeCpcbPiboData();

        console.log("✅ PIBO cron completed:", {
          total: result.totalScraped,
          new: result.newCompanies,
        });

      } catch (err) {
        console.error("❌ PIBO cron error:", err.message);
      }
    },
    {
      timezone: "Asia/Kolkata",
    }
  );
};