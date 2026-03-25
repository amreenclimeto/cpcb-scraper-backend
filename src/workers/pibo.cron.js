import cron from "node-cron";
import { scrapeCpcbPiboData } from "../scraper/Pibo.scraper.js";

// 🕔 Daily 5 PM (IST)
export const startPiboCron = () => {
  cron.schedule(
    "0 17 * * *", // 5:00 PM
    async () => {
      try {
        console.log("⏰ Running PIBO scraper (cron 5 PM)");

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
      timezone: "Asia/Kolkata", // 🔥 important
    }
  );
};