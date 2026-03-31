import cron from "node-cron";
import { runEprScraper } from "../services/eprCertificate.service.js";

// 🕔 Daily 5 PM (IST)
export const startPwpCertificate = () => {
  cron.schedule(
    "0 */2 * * *", 
    async () => {
      try {
        console.log("⏰ Running pwp certificate scraper (cron every 2 hour)");

        const result = await runEprScraper();

        console.log("✅ PIBO pwp certificate scraper completed:", {
          result: result
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