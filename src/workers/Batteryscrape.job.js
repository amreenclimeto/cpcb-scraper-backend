import cron from "node-cron";
import { runFullScrape } from "../controllers/batteryMetalController.js";

export function startBatteryScrapeJob() {

  console.log("⏰ Battery scrape cron registered — runs every 1 hour");

  // Runs every hour at :00
  cron.schedule("0 * * * *", async () => {

    const startTime = new Date();
    console.log(`\n🔄 [CRON] Battery scrape started at ${startTime.toISOString()}`);

    try {

      const results = await runFullScrape();

      const endTime  = new Date();
      const duration = ((endTime - startTime) / 1000 / 60).toFixed(2);

      console.log(`✅ [CRON] Scrape completed in ${duration} mins`);
      console.log("📊 Results:", JSON.stringify(results, null, 2));

    } catch (err) {

      console.error("❌ [CRON] Scrape failed:", err.message);

    }

  });

}