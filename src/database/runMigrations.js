// runMigrations.js
import pool from "../config/db.config.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigrations() {

  // ✅ Track which migrations already ran
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE,
      ran_at TIMESTAMP DEFAULT NOW()
    )
  `);

const migrationsDir = path.join(__dirname, "../migrations");
  const files = fs.readdirSync(migrationsDir).sort();

  for (const file of files) {

    // ✅ Skip if already ran
    const { rows } = await pool.query(
      "SELECT 1 FROM migrations WHERE filename = $1",
      [file]
    );

    if (rows.length > 0) {
      console.log(`Skipping (already ran): ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");

    await pool.query(sql);

    await pool.query(
      "INSERT INTO migrations (filename) VALUES ($1)",
      [file]
    );

    console.log(`✅ Migrated: ${file}`);

  }

  console.log("All migrations done.");
  process.exit(0);

}

runMigrations().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});