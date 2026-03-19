import { chromium } from "playwright";
import pool from "../config/db.config.js";

process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled rejection:", reason?.message || reason);
});

const DASHBOARD_URL =
  "https://eprplastic.cpcb.gov.in/#/plastic/home/main_dashboard";

const PWP_API_URL =
  "https://eprplastic.cpcb.gov.in/epr/api/v1.0/pibo/fetch_pwp_application_details_by_status";

// ─── Main Export ─────────────────────────────────────────────────────────────
export const scrapeCpcbPwpData = async () => {
  let browser = null;

  const stats = {
    totalScraped: 0,
    newCompanies: 0,
    statusChanges: 0,
  };

  try {
    console.log("🚀 PWP scraper starting...");

    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
        "--single-process",
      ],
      ignoreHTTPSErrors: true,
    });

    console.log("✅ Browser launched");

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    try {
      console.log("🌐 Loading dashboard...");
      await page.goto(DASHBOARD_URL, {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      console.log("✅ Dashboard loaded");
      await page.waitForTimeout(3000);

      // Step 1: Token intercept
      const token = await interceptToken(page);

      if (!token) {
        console.error("❌ Token not captured");
        return { success: false, error: "Token not captured" };
      }

      console.log(`🔑 Token captured (${token.length} chars)`);

      // Step 2: API call via browser fetch
      console.log("🌐 Calling PWP API via browser fetch...");

      const startTime = Date.now();
      const result = await page.evaluate(
        async ({ url, token }) => {
          try {
            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ epr_plastic: token }),
            });

            if (!res.ok) {
              return { error: `HTTP ${res.status}: ${res.statusText}` };
            }

            const json = await res.json();
            return { success: true, json };
          } catch (e) {
            return { error: e.message };
          }
        },
        { url: PWP_API_URL, token }
      );

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (result.error) {
        console.error(`❌ Browser fetch failed: ${result.error}`);
        return { success: false, error: result.error };
      }

      const json = result.json;
      const rows = json?.data?.tableData?.bodyContent || [];
      const total = json?.data?.total_no ?? "N/A";

      console.log(`📊 API response (${elapsed}s):`);
      console.log(`   → api status: ${json?.status}`);
      console.log(`   → total_no:   ${total}`);
      console.log(`   → rows:       ${rows.length}`);

      if (rows.length === 0) {
        console.warn("⚠️ No rows in response");
        return {
          success: true,
          totalScraped: 0,
          newCompanies: 0,
          statusChanges: 0,
        };
      }

      // Step 3: DB mein save
      console.log(`💾 Saving ${rows.length} rows to DB...`);
      const dbResult = await savePwpData(rows, "Registered");

      stats.totalScraped = rows.length;
      stats.newCompanies = dbResult.newCompanies;
      stats.statusChanges = dbResult.statusChanges;

      console.log(`✅ Done:`);
      console.log(`   → Total rows:     ${dbResult.total}`);
      console.log(`   → New companies:  ${dbResult.newCompanies}`);
      console.log(`   → Status changes: ${dbResult.statusChanges}`);
      console.log(`   → First scrape:   ${dbResult.isFirstScrape}`);

    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      await page.close().catch(() => {});
      console.log("🔒 Page closed");
    }

    console.log(`\n${"═".repeat(50)}`);
    console.log("🎉 PWP scrape complete!");
    console.log(`   → Total scraped:  ${stats.totalScraped}`);
    console.log(`   → New companies:  ${stats.newCompanies}`);
    console.log(`   → Status changes: ${stats.statusChanges}`);
    console.log(`${"═".repeat(50)}\n`);

    return { success: true, ...stats };

  } catch (err) {
    console.error("❌ PWP SCRAPER FATAL ERROR:", err.message);
    return { success: false, error: err.message, ...stats };
  } finally {
    if (browser) {
      await browser.close();
      console.log("🔒 Browser closed");
    }
  }
};

// ─── Token intercept ─────────────────────────────────────────────────────────
async function interceptToken(page) {
  console.log("⏱️ Token intercept starting...");

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
      done(null, new Error("Token intercept timeout for PWP"));
    }, 30000);

    page.on("request", (request) => {
      try {
        const url = request.url();

        // Debug log
        if (url.includes("fetch_pwp") || url.includes("fetch_pibo")) {
          console.log(`🔍 Intercepted URL: ${url}`);
        }

        if (
          !url.includes("fetch_pwp_application_details_by_status") ||
          request.method() !== "POST"
        ) return;

        const bodyStr = request.postData();
        if (!bodyStr) return;

        let body;
        try { body = JSON.parse(bodyStr); } catch { return; }

        const token = body?.epr_plastic;
        if (!token) return;

        console.log("🔐 Token intercepted from PWP request");
        done(token);
      } catch (e) {
        // silent
      }
    });

    (async () => {
      try {
        console.log("🔍 Waiting for PWP registered card...");
        await page.waitForSelector(
          ".card.count-content-pwp.registered .fa.fa-external-link",
          { timeout: 15000 }
        );

        console.log("🖱️ Clicking PWP Registered icon...");
        await page.click(
          ".card.count-content-pwp.registered .fa.fa-external-link"
        );
        console.log("✅ Clicked — waiting for token...");
      } catch (err) {
        done(null, err);
      }
    })();
  });
}

// ─── Save with baseline + is_new flag ────────────────────────────────────────
async function savePwpData(rows, status) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Baseline check
    const baselineResult = await client.query(
      `SELECT baseline_count FROM pwp_baseline LIMIT 1`
    );
    const isFirstScrape = baselineResult.rows.length === 0;
    console.log(`📌 PWP isFirstScrape: ${isFirstScrape}`);

    // Existing records
    const existing = await client.query(
      `SELECT company_id, status FROM pwp_companies`
    );
    console.log(`🗄️ Existing in DB: ${existing.rows.length}`);

    const existingMap = new Map();
    existing.rows.forEach((r) =>
      existingMap.set(String(r.company_id), r.status)
    );

    let newCompanies = 0;
    let statusChanges = 0;
    let batchCount = 0;

    for (const item of rows) {
      const id = String(item.company_id);
      const oldStatus = existingMap.get(id);
      const isNew = !existingMap.has(id);

      if (isNew) {
        // Pehli baar scrape ho to is_new = false (baseline)
        // Baad mein naye aaye to is_new = true (flag karo)
        const flagNew = !isFirstScrape;
        if (flagNew) newCompanies++;

        await client.query(
          `INSERT INTO pwp_companies
            (company_id, company, state, category, class, address, status,
             is_new, first_seen_at, last_seen_at, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW(),NOW())
           ON CONFLICT (company_id) DO NOTHING`,
          [
            item.company_id,
            item.company,
            item.state,
            item.category,
            item.class,
            item.address,
            status,
            flagNew,
          ]
        );

        await client.query(
          `INSERT INTO pwp_status_history (company_id, old_status, new_status)
           VALUES ($1, NULL, $2)`,
          [item.company_id, status]
        );

      } else if (oldStatus !== status) {
        statusChanges++;

        await client.query(
          `INSERT INTO pwp_status_history (company_id, old_status, new_status)
           VALUES ($1, $2, $3)`,
          [item.company_id, oldStatus, status]
        );

        await client.query(
          `UPDATE pwp_companies
           SET status=$2, last_seen_at=NOW(), synced_at=NOW()
           WHERE company_id=$1`,
          [item.company_id, status]
        );

      } else {
        // Existing record — sirf timestamps update karo
        await client.query(
          `UPDATE pwp_companies
           SET last_seen_at=NOW(), synced_at=NOW()
           WHERE company_id=$1`,
          [item.company_id]
        );
      }

      batchCount++;
      if (batchCount % 5000 === 0) {
        console.log(`⚡ PWP DB progress: ${batchCount}/${rows.length} rows`);
      }
    }

    // Baseline save — sirf pehli baar
    if (isFirstScrape) {
      await client.query(
        `INSERT INTO pwp_baseline (baseline_count, set_at)
         VALUES ($1, NOW())`,
        [rows.length]
      );
      console.log(`📌 PWP Baseline saved: ${rows.length}`);
    }

    await client.query("COMMIT");
    console.log("✅ PWP Transaction committed");

    return { total: rows.length, newCompanies, statusChanges, isFirstScrape };

  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`❌ PWP DB error, rolled back: ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
}