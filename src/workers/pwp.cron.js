import cron from "node-cron";
import { scrapeCpcbPwpData } from "../scraper/pwp.scraper.js";

export const startPwpCron = () => {
  cron.schedule(
    "0 17 * * *", // 🕔 5 PM daily
    async () => {
      try {
        console.log("⏰ Running PWP scraper (5 PM)");

        const result = await scrapeCpcbPwpData();

        if (!result.success) {
          console.error("❌ PWP cron failed:", result.error);
          return;
        }

        console.log("✅ PWP cron completed:", {
          total: result.totalScraped,
          new: result.newCompanies,
          statusChanges: result.statusChanges,
        });

      } catch (err) {
        console.error("❌ PWP cron error:", err.message);
      }
    },
    {
      timezone: "Asia/Kolkata", // 🔥 must
    }
  );
};