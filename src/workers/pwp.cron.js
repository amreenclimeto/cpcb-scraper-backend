import cron from "node-cron";
import { scrapeCpcbPwpData } from "../scraper/pwp.scraper.js";

export const startPwpCron = () => {
  cron.schedule(
    "0 */2 * * *",
    async () => {
      try {
        console.log("⏰ Running PWP scraper (every 2 hours)");

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
      timezone: "Asia/Kolkata",
    }
  );
};