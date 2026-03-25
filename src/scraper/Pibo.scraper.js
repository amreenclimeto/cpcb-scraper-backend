import { chromium } from "playwright";
import pool from "../config/db.config.js";

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

// ─── Main Export ─────────────────────────────────────────────────────────────
export const scrapeCpcbPiboData = async () => {
  let browser = null;

  const stats = {
    totalScraped: 0,
    newCompanies: 0,
    statusChanges: 0,
    byEntity: {},
  };

  try {
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

async function savePiboData(rows, entityType, status) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const baselineResult = await client.query(
      `SELECT baseline_count FROM pibo_baseline WHERE entity_type = $1`,
      [entityType],
    );
    const isFirstScrape = baselineResult.rows.length === 0;

    const existing = await client.query(
      `SELECT company_id, status FROM pibo_companies WHERE entity_type = $1`,
      [entityType],
    );

    // savePiboData mein ye add karo loop se pehle
    const apiIds = rows.map((r) => Number(r.company_id));
    const uniqueApiIds = new Set(apiIds);
    console.log(
      `🔍 [${entityType}] API total: ${rows.length}, Unique IDs: ${uniqueApiIds.size}`,
    );

    // Duplicate IDs find karo
    const seen = new Set();
    const duplicates = [];
    for (const row of rows) {
      const id = Number(row.company_id);
      if (seen.has(id)) {
        duplicates.push(id);
      }
      seen.add(id);
    }
    console.log(
      `🔍 [${entityType}] Duplicate IDs in API: ${duplicates.length}`,
      duplicates.slice(0, 10),
    );

    const existingMap = new Map();
    existing.rows.forEach((r) =>
      existingMap.set(Number(r.company_id), r.status),
    );

    let newCompanies = 0;
    let statusChanges = 0;
    let batchCount = 0;

    // ─── DEBUG TRACKING ───────────────────────────────────
    let skippedConflict = 0;
    let inserted = 0;
    let updated = 0;
    const missingIds = []; // jo DB mein nahi hain
    // ──────────────────────────────────────────────────────

    for (const item of rows) {
      const id = Number(item.company_id);
      const oldStatus = existingMap.get(id);
      const isNew = !existingMap.has(id);

      if (isNew) {
        const flagNew = !isFirstScrape;
        if (flagNew) {
          newCompanies++;
          missingIds.push(id); // track karo
        }

        const result = await client.query(
          `INSERT INTO pibo_companies
            (company_id, company, address, email, entity_type, status,
             is_new, first_seen_at, last_seen_at, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
           ON CONFLICT (company_id, entity_type) DO NOTHING
           RETURNING company_id`,
          [
            id,
            item.company,
            item.address,
            item.email !== "***" ? item.email : null,
            entityType,
            status,
            flagNew,
          ],
        );

        if (result.rowCount === 0) {
          skippedConflict++;
          console.log(
            `⚠️ [${entityType}] CONFLICT SKIP: company_id=${id}, company=${item.company}`,
          );
        } else {
          inserted++;
        }

        await client.query(
          `INSERT INTO pibo_status_history (company_id, entity_type, old_status, new_status)
           VALUES ($1, $2, NULL, $3)`,
          [id, entityType, status],
        );
      } else if (oldStatus !== status) {
        statusChanges++;
        updated++;

        await client.query(
          `INSERT INTO pibo_status_history (company_id, entity_type, old_status, new_status)
           VALUES ($1, $2, $3, $4)`,
          [id, entityType, oldStatus, status],
        );

        await client.query(
          `UPDATE pibo_companies
           SET status = $2, last_seen_at = NOW(), synced_at = NOW()
           WHERE company_id = $1 AND entity_type = $3`,
          [id, status, entityType],
        );
      } else {
        await client.query(
          `UPDATE pibo_companies
           SET last_seen_at = NOW(), synced_at = NOW()
           WHERE company_id = $1 AND entity_type = $2`,
          [id, entityType],
        );
      }

      batchCount++;
      if (batchCount % 5000 === 0) {
        console.log(
          `⚡ [${entityType}] DB progress: ${batchCount}/${rows.length} rows`,
        );
      }
    }

    // ─── DEBUG SUMMARY ────────────────────────────────────
    console.log(`\n📊 [${entityType}] DEBUG SUMMARY:`);
    console.log(`   → API rows received:  ${rows.length}`);
    console.log(`   → DB existing:        ${existing.rows.length}`);
    console.log(`   → Inserted:           ${inserted}`);
    console.log(`   → Conflict skipped:   ${skippedConflict}`);
    console.log(`   → Updated:            ${updated}`);
    console.log(`   → New flagged:        ${newCompanies}`);
    if (missingIds.length > 0) {
      console.log(`   → New company_ids:    ${missingIds.join(", ")}`);
    }
    // ──────────────────────────────────────────────────────

    if (isFirstScrape) {
      await client.query(
        `INSERT INTO pibo_baseline (entity_type, baseline_count, set_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (entity_type)
         DO UPDATE SET baseline_count = $2, set_at = NOW()`,
        [entityType, rows.length],
      );
      console.log(`📌 [${entityType}] Baseline saved: ${rows.length}`);
    }

    await client.query("COMMIT");
    console.log(`✅ [${entityType}] Transaction committed`);

    return { total: rows.length, newCompanies, statusChanges, isFirstScrape };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`❌ [${entityType}] DB error, rolled back: ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
}
