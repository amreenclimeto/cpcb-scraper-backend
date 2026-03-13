import batteryProdMetalWiseDashboardLinks from "../scraper/batteryProdMetalWiseDashboard.scraper.js";
import scrapeMetalData, {
  sleep,
  DELAY_BETWEEN_METALS,
} from "../scraper/metalData.scraper.js";
import { upsertBatteryProducer } from "../services/Batteryproducer.service.js";
import { processBatteryMetalTarget } from "../services/Batterymetaltarget.service.js";

export async function runFullScrape() {
  const results = {};

  const metalLinks = await batteryProdMetalWiseDashboardLinks();

  for (const { metal, href } of metalLinks) {
    console.log(`\n========== [${metal.toUpperCase()}] ==========`);

    const stats = { inserted: 0, updated: 0, unchanged: 0, skipped: 0 };

    const rows = await scrapeMetalData(href, metal);

    for (const row of rows) {
      if (!row.user_id || !row.users) {
        stats.skipped++;
        continue;
      }

      await upsertBatteryProducer(row);

      const status = await processBatteryMetalTarget(row, metal);
      stats[status]++;
    }

    console.log(`[${metal}] Done →`, stats);
    results[metal] = { total: rows.length, ...stats };

    // ✅ 5s delay between metals
    console.log(`Waiting ${DELAY_BETWEEN_METALS / 1000}s before next metal...`);
    await sleep(DELAY_BETWEEN_METALS);
  }

  return results;
}

export async function scrapeAllMetalsController(req, res) {
  try {
    const results = await runFullScrape();
    res.json({ status: "success", results });
  } catch (err) {
    console.error("Scrape failed:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
}
