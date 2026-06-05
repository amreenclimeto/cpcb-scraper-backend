import { chromium } from "playwright";
import pool from "../config/db.config.js";
import { savePiboData } from "../services/pibo.service.js";

const PIBO_SCRAPE_LOCK_ID = 8392741;

process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled rejection:", reason?.message || reason);
});

const DASHBOARD_URL =
  "https://eprplastic.cpcb.gov.in/#/plastic/home/main_dashboard";

const PIBO_API_URL =
  "https://eprplastic.cpcb.gov.in/epr/api/v1.0/pibo/fetch_pibo_application_details_by_status";

const ENTITY_TYPES = ["Brand Owner", "Producer", "Importer"];

const TIMEOUT_MS = {
  "Brand Owner": 30000,
  Producer: 30000,
  Importer: 120000,
};

async function acquirePiboScrapeLock() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [PIBO_SCRAPE_LOCK_ID],
    );
    if (!result.rows[0]?.acquired) {
      client.release();
      return null;
    }
    return client;
  } catch (err) {
    client.release();
    throw err;
  }
}

async function releasePiboScrapeLock(lockClient) {
  if (!lockClient) return;
  try {
    await lockClient.query("SELECT pg_advisory_unlock($1)", [
      PIBO_SCRAPE_LOCK_ID,
    ]);
  } finally {
    lockClient.release();
  }
}

// ─── Main Export ─────────────────────────────────────────────────────────────
export const scrapeCpcbPiboData = async () => {
  let browser = null;
  let lockClient = null;

  const stats = {
    totalScraped: 0,
    newCompanies: 0,
    statusChanges: 0,
    byEntity: {},
  };

  try {
    lockClient = await acquirePiboScrapeLock();
    if (!lockClient) {
      console.log("⚠️ PIBO scrape already running — skipping duplicate run");
      return {
        success: false,
        error: "PIBO scrape already in progress",
        ...stats,
      };
    }

    console.log("🚀 PIBO scraper starting...");

    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
      ],
      ignoreHTTPSErrors: true,
    });

    console.log("✅ Browser launched");

    const context = await browser.newContext({ ignoreHTTPSErrors: true });

    for (const entityType of ENTITY_TYPES) {
      console.log(`\n${"─".repeat(50)}`);
      console.log(`📋 [${entityType}] Starting scrape → Registered`);
      console.log(`${"─".repeat(50)}`);

      const page = await context.newPage();

      page.on("close", () => {
        console.log(`❌ [${entityType}] Page closed unexpectedly`);
      });

      page.on("crash", () => {
        console.log(`💥 [${entityType}] Page crashed`);
      });

      page.on("framenavigated", () => {
        console.log(`🔄 [${entityType}] Page navigated/reloaded`);
      });

      try {
        console.log(`🌐 [${entityType}] Loading dashboard...`);
        await page.goto(DASHBOARD_URL, {
          waitUntil: "networkidle",
          timeout: 60000,
        });

        if (entityType === "Importer") {
          console.log("⏳ Extra wait for Importer...");
          await page.waitForTimeout(5000);
        }
        console.log(`✅ [${entityType}] Dashboard loaded`);
        await page.waitForTimeout(3000);

        // Step 1: Token intercept karo
        const token = await interceptToken(page, entityType);

        if (!token) {
          console.error(`❌ [${entityType}] Token not captured`);
          stats.byEntity[entityType] = { error: "Token not captured" };
          continue;
        }

        console.log(
          `🔑 [${entityType}] Token captured (${token.length} chars)`,
        );

        // Step 2: Usi page ke browser context se API call karo
        // page.evaluate() browser ke andar run hota hai
        // SSL/proxy sab browser handle karta hai — Node fetch jaisi problem nahi ✅
        console.log(
          `🌐 [${entityType}] Calling API via browser fetch (page.evaluate)...`,
        );

        const startTime = Date.now();
        // const result = await page.evaluate(
        //   async ({ url, token }) => {
        //     try {
        //       const res = await fetch(url, {
        //         method: "POST",
        //         headers: { "Content-Type": "application/json" },
        //         body: JSON.stringify({ epr_plastic: token }),
        //       });

        //       if (!res.ok) {
        //         return { error: `HTTP ${res.status}: ${res.statusText}` };
        //       }

        //       const json = await res.json();
        //       return { success: true, json };
        //     } catch (e) {
        //       return { error: e.message };
        //     }
        //   },
        //   { url: PIBO_API_URL, token },
        // );

        if (page.isClosed()) {
          throw new Error(
            `[${entityType}] Page already closed before evaluate`,
          );
        }

        let result;
        let retries = 2;

        while (retries--) {
          try {
            result = await page.evaluate(
              async ({ url, token }) => {
                try {
                  const res = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ epr_plastic: token }),
                  });

                  if (!res.ok) {
                    return { error: `HTTP ${res.status}` };
                  }

                  const json = await res.json();
                  return { success: true, json };
                } catch (e) {
                  return { error: e.message };
                }
              },
              { url: PIBO_API_URL, token },
            );

            break; // success
          } catch (err) {
            console.log(`⚠️ Retry evaluate (${entityType})...`);

            if (retries === 0) {
              throw new Error(`Evaluate failed after retry: ${err.message}`);
            }

            await page.waitForTimeout(3000);
          }
        }
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        if (result.error) {
          console.error(
            `❌ [${entityType}] Browser fetch failed: ${result.error}`,
          );
          stats.byEntity[entityType] = { error: result.error };
          continue;
        }

        const json = result.json;
        const rows = json?.data?.tableData?.bodyContent || [];
        const total = json?.data?.total_no ?? "N/A";

        console.log(`📊 [${entityType}] API response (${elapsed}s):`);
        console.log(`   → api status: ${json?.status}`);
        console.log(`   → total_no:   ${total}`);
        console.log(`   → rows:       ${rows.length}`);

        if (rows.length === 0) {
          console.warn(`⚠️  [${entityType}] No rows in response`);
          console.warn(
            `   → data keys: ${Object.keys(json?.data || {}).join(", ")}`,
          );
          stats.byEntity[entityType] = {
            total: 0,
            newCompanies: 0,
            statusChanges: 0,
          };
          continue;
        }

        // Step 3: DB mein save karo
        console.log(`💾 [${entityType}] Saving ${rows.length} rows to DB...`);
        const dbResult = await savePiboData(rows, entityType, "Registered");

        stats.byEntity[entityType] = dbResult;
        stats.totalScraped += rows.length;
        stats.newCompanies += dbResult.newCompanies;
        stats.statusChanges += dbResult.statusChanges;

        console.log(`✅ [${entityType}] Done:`);
        console.log(`   → Total rows:     ${dbResult.total}`);
        console.log(`   → New companies:  ${dbResult.newCompanies}`);
        console.log(`   → Status changes: ${dbResult.statusChanges}`);
        console.log(`   → First scrape:   ${dbResult.isFirstScrape}`);
      } catch (err) {
        console.error(`❌ [${entityType}] Error: ${err.message}`);
        stats.byEntity[entityType] = { error: err.message };
      } finally {
        // await page.close().catch(() => {});
        if (!page.isClosed()) {
          await page.close().catch(() => {});
        }
        console.log(`🔒 [${entityType}] Page closed`);
      }
    }

    console.log(`\n${"═".repeat(50)}`);
    console.log("🎉 PIBO scrape complete!");
    console.log(`   → Total scraped:  ${stats.totalScraped}`);
    console.log(`   → New companies:  ${stats.newCompanies}`);
    console.log(`   → Status changes: ${stats.statusChanges}`);
    console.log(`${"═".repeat(50)}\n`);

    return { success: true, ...stats };
  } catch (err) {
    console.error("❌ PIBO SCRAPER FATAL ERROR:", err.message);
    return { success: false, error: err.message, ...stats };
  } finally {
    if (browser) {
      await browser.close();
      console.log("🔒 Browser closed");
    }
    await releasePiboScrapeLock(lockClient);
  }
};

// ─── Token intercept — request.postData() synchronous hai ────────────────────
async function interceptToken(page, entityType) {
  const timeoutMs = TIMEOUT_MS[entityType] || 30000;
  console.log(
    `⏱️  [${entityType}] Token intercept timeout: ${timeoutMs / 1000}s`,
  );

  return new Promise((resolve, reject) => {
    let resolved = false;
    let timer = null;

    const done = (val, err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      err ? reject(err) : resolve(val);
    };

    timer = setTimeout(() => {
      done(null, new Error(`Token intercept timeout for ${entityType}`));
    }, timeoutMs);

    page.on("request", (request) => {
      try {
        if (
          !request.url().includes("fetch_pibo_application_details_by_status") ||
          request.method() !== "POST"
        )
          return;

        const bodyStr = request.postData();
        if (!bodyStr) return;

        let body;
        try {
          body = JSON.parse(bodyStr);
        } catch {
          return;
        }

        const token = body?.epr_plastic;
        if (!token) return;

        console.log(`🔐 [${entityType}] Token intercepted from request`);
        done(token);
      } catch (e) {
        // silent
      }
    });

    (async () => {
      try {
        console.log(`🔍 [${entityType}] Waiting for cards...`);
        await page.waitForSelector(".card.card-primary", { timeout: 15000 });

        const cards = await page.$$(".card.card-primary");
        console.log(`📋 [${entityType}] Cards found: ${cards.length}`);

        let clicked = false;

        for (const card of cards) {
          const titleEl = await card.$(".card-title");
          if (!titleEl) continue;

          const titleText = (await titleEl.textContent()).trim();
          console.log(`   → Card: "${titleText}"`);

          if (titleText !== entityType) continue;

          const registeredIcon = await card.$(
            ".count-content.registered .fa.fa-external-link",
          );

          if (!registeredIcon) {
            done(
              null,
              new Error(`Registered icon not found for ${entityType}`),
            );
            return;
          }

          console.log(`🖱️  [${entityType}] Clicking Registered icon...`);
          // await registeredIcon.click();
          await Promise.all([
            page.waitForResponse((res) =>
              res.url().includes("fetch_pibo_application_details_by_status"),
            ),
            registeredIcon.click(),
          ]);
          console.log(`✅ [${entityType}] Clicked — waiting for token...`);
          clicked = true;
          break;
        }

        if (!clicked) done(null, new Error(`Card not found: ${entityType}`));
      } catch (err) {
        done(null, err);
      }
    })();
  });
}

