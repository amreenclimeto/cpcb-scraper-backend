import cron from "node-cron";
import { runEprScraper } from "../services/eprCertificate.service.js";

cron.schedule("0 */2 * * *", async () => {
  console.log("Running EPR scraper...");
  await runEprScraper();
});