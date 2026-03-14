import { chromium } from "playwright";
import pool from "../config/db.config.js";

process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled rejection:", reason?.message || reason);
});

const PWP_CARDS = [
  {
    selector: '.card.count-content-pwp.registered .fa.fa-external-link',
    status: 'Registered',
  },
  {
    selector: '.card.count-content-pwp.inProgress .fa.fa-external-link',
    status: 'In Process',
  },
  {
    selector: '.card.count-content-pwp.notApproved .fa.fa-external-link',
    status: 'Not Approved',
  },
];

const DASHBOARD_URL =
  "https://eprplastic.cpcb.gov.in/#/plastic/home/main_dashboard";

export const scrapeCpcbPwpData = async () => {
  let browser = null;

  const stats = {
    totalScraped: 0,
    newCompanies: 0,
    statusChanges: 0,
    byStatus: {},
  };

  try {
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

    const context = await browser.newContext({ ignoreHTTPSErrors: true });

    for (const card of PWP_CARDS) {
      console.log(`\n📋 Scraping card: ${card.status}`);

      // Har card ke liye fresh page
      const page = await context.newPage();

      try {
        console.log(`🌐 Loading dashboard for: ${card.status}`);

        await page.goto(DASHBOARD_URL, {
          waitUntil: "networkidle",
          timeout: 60000,
        });

        await page.waitForTimeout(3000);

        const rows = await scrapeCard(page, card).catch((err) => {
          console.error(`❌ scrapeCard failed for ${card.status}:`, err.message);
          return [];
        });

        console.log(`📊 ${card.status}: ${rows.length} rows received`);

        if (rows.length > 0) {
          const result = await savePwpData(rows, card.status);
          stats.byStatus[card.status] = result;
          stats.totalScraped += rows.length;
          stats.newCompanies += result.newCompanies;
          stats.statusChanges += result.statusChanges;

          console.log(
            `✅ ${card.status}: ${result.newCompanies} new, ${result.statusChanges} status changes`
          );
        } else {
          stats.byStatus[card.status] = {
            total: 0,
            newCompanies: 0,
            statusChanges: 0,
          };
        }

      } catch (err) {
        console.error(`❌ Error on card ${card.status}:`, err.message);
        stats.byStatus[card.status] = { error: err.message };
      } finally {
        await page.close(); // har card ke baad page band karo
      }
    }

    console.log("\n🎉 PWP complete:", stats);
    return { success: true, ...stats };

  } catch (err) {
    console.error("❌ PWP SCRAPER ERROR:", err.message);
    return { success: false, error: err.message, ...stats };

  } finally {
    if (browser) await browser.close();
  }
};

// ─── Single card scrape — response intercept karo ────────
async function scrapeCard(page, card) {
  return new Promise(async (resolve, reject) => {
    let timeout = null;

    try {
      timeout = setTimeout(() => {
        reject(new Error(`Payload timeout for ${card.status}`));
      }, 25000);

      // 🆕 Response intercept karo — request nahi
      page.on("response", async (response) => {
        try {
          if (
            response.url().includes("fetch_pwp_application_details_by_status") &&
            response.request().method() === "POST" &&
            response.status() === 200
          ) {
            clearTimeout(timeout);

            console.log(`🔐 Response captured for: ${card.status}`);

            const json = await response.json();
            const rows = json?.data?.tableData?.bodyContent || [];

            console.log(
              `📊 ${card.status}: API total=${json?.data?.total_no}, received=${rows.length}`
            );

            resolve(rows);
          }
        } catch (e) {
          // silent
        }
      });

      // Card click
      await page.waitForSelector(card.selector, { timeout: 15000 });
      await page.click(card.selector);
      console.log(`🖱️ Clicked: ${card.status}`);

    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}

// ─── Save with tracking ───────────────────────────────────
async function savePwpData(rows, status) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT company_id, status FROM pwp_companies`
    );

    const existingMap = new Map();
    existing.rows.forEach((r) =>
      existingMap.set(String(r.company_id), r.status)
    );

    let newCompanies = 0;
    let statusChanges = 0;

    for (const item of rows) {
      const id = String(item.company_id);
      const oldStatus = existingMap.get(id);
      const isNew = !existingMap.has(id);

      if (isNew) {
        newCompanies++;

        await client.query(
          `INSERT INTO pwp_companies
            (company_id, company, state, category, class, address, status,
             first_seen_at, last_seen_at, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW(),NOW())
           ON CONFLICT (company_id) DO NOTHING`,
          [
            item.company_id,
            item.company,
            item.state,
            item.category,
            item.class,
            item.address,
            status,
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
        await client.query(
          `UPDATE pwp_companies
           SET last_seen_at=NOW(), synced_at=NOW()
           WHERE company_id=$1`,
          [item.company_id]
        );
      }
    }

    await client.query("COMMIT");
    return { total: rows.length, newCompanies, statusChanges };

  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}