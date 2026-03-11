import pool from "../config/db.config.js";
import { normalizeText } from "../utils/normalize.js";

// ✅ Auto-create table if it doesn't exist
async function ensureTableExists() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plasticwastemanagement (
      reg_id VARCHAR PRIMARY KEY,
      application_id VARCHAR,
      company_legal_name TEXT,
      company_trade_name TEXT,
      legal_name_normalized TEXT,
      applicant_type VARCHAR,
      status VARCHAR,
      created_on VARCHAR,
      is_active BOOLEAN DEFAULT TRUE,
      last_seen_at TIMESTAMP,
      synced_at TIMESTAMP
    )
  `);
  console.log(`✅ Table 'plasticwastemanagement' is ready`);
}

export async function saveNationalEprToPG(rows) {
  if (!rows || rows.length === 0) {
    console.log("⚠️ No rows to save");
    return { inserted: 0, updated: 0 };
  }

  console.log(`💾 Starting to save ${rows.length} records to database...`);

  // First, verify connection and table
  let initialCount = 0;
  try {
    // Show connection details
    const dbInfo = await pool.query(`SELECT current_database() as db, current_schema() as schema, current_user as user`);
    console.log(`🔍 Connected to: DB=${dbInfo.rows[0]?.db}, Schema=${dbInfo.rows[0]?.schema}, User=${dbInfo.rows[0]?.user}`);
    console.log(`🔍 Connection string: ${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB}`);

    // ✅ Auto-create table if missing
    await ensureTableExists();

    // Check if table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'plasticwastemanagement'
      ) as exists
    `);

    if (!tableExists.rows[0]?.exists) {
      throw new Error(`Table 'plasticwastemanagement' does not exist in schema 'public'`);
    }
    console.log(`✅ Table 'plasticwastemanagement' exists`);

    const countResult = await pool.query(`SELECT COUNT(*) as count FROM plasticwastemanagement`);
    initialCount = parseInt(countResult.rows[0]?.count || 0);
    console.log(`📊 Current records in table: ${initialCount}`);

    // Test query to verify we can read/write
    const testResult = await pool.query(`SELECT reg_id FROM plasticwastemanagement LIMIT 1`);
    console.log(`🔍 Table access test: ${testResult.rows.length > 0 ? 'Found existing records' : 'Table is empty'}`);
  } catch (err) {
    console.error(`❌ Error checking table:`, err.message);
    console.error(`❌ Error stack:`, err.stack);
    throw new Error(`Table plasticwastemanagement might not exist or is not accessible: ${err.message}`);
  }

  let inserted = 0;
  let updated = 0;
  let errors = 0;
  const BATCH_SIZE = 500;

  // Process in batches
  for (let batchStart = 0; batchStart < rows.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, rows.length);
    const batch = rows.slice(batchStart, batchEnd);

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      for (const row of batch) {
        try {
          // Check if exists before insert to track inserts vs updates
          const existsResult = await client.query(
            `SELECT reg_id FROM plasticwastemanagement WHERE reg_id = $1`,
            [row.reg_id]
          );
          const recordExists = existsResult.rows.length > 0;

          // Normalize company legal name for search
          const normalizedName = row.company_legal_name
            ? normalizeText(row.company_legal_name)
            : null;

          // Perform insert/update
          await client.query(
            `
            INSERT INTO plasticwastemanagement (
              reg_id,
              application_id,
              company_legal_name,
              company_trade_name,
              legal_name_normalized,
              applicant_type,
              status,
              created_on,
              is_active,
              last_seen_at,
              synced_at
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,NOW(),NOW())
            ON CONFLICT (reg_id)
            DO UPDATE SET
              application_id = EXCLUDED.application_id,
              company_legal_name = EXCLUDED.company_legal_name,
              company_trade_name = EXCLUDED.company_trade_name,
              legal_name_normalized = EXCLUDED.legal_name_normalized,
              applicant_type = EXCLUDED.applicant_type,
              status = EXCLUDED.status,
              is_active = TRUE,
              last_seen_at = NOW(),
              synced_at = NOW()
            `,
            [
              row.reg_id,
              row.application_id || null,
              row.company_legal_name || null,
              row.company_trade_name || null,
              normalizedName,
              row.applicant_type || null,
              row.status || null,
              row.created_on || null
            ]
          );

          if (recordExists) {
            updated++;
          } else {
            inserted++;
          }
        } catch (err) {
          errors++;
          if (errors <= 10) {
            console.error(`❌ PG insert failed for reg_id ${row?.reg_id || 'unknown'}:`, err.message);
            if (errors === 1) {
              console.error(`❌ First error details:`, {
                message: err.message,
                code: err.code,
                detail: err.detail,
                hint: err.hint
              });
            }
          }
        }
      }

      // Commit the batch
      await client.query('COMMIT');

      // Verify batch was committed by checking one record
      if (batch.length > 0 && batch[0].reg_id) {
        const verifyCommit = await pool.query(
          `SELECT reg_id FROM plasticwastemanagement WHERE reg_id = $1`,
          [batch[0].reg_id]
        );
        if (verifyCommit.rows.length === 0) {
          console.error(`❌ WARNING: Batch committed but record ${batch[0].reg_id} not found in table!`);
        }
      }

    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`❌ Batch ${batchStart}-${batchEnd} failed, rolling back:`, err.message);
      throw err;
    } finally {
      client.release();
    }

    // Log progress
    if (batchEnd % 1000 === 0 || batchEnd === rows.length) {
      const currentCount = await pool.query(`SELECT COUNT(*) as count FROM plasticwastemanagement`);
      const currentTotal = parseInt(currentCount.rows[0]?.count || 0);
      console.log(`💾 Saving progress: ${batchEnd}/${rows.length} (${inserted} inserted, ${updated} updated, ${errors} errors) | Table now has: ${currentTotal} records`);
    }
  }

  // Verify final count
  let finalCount = 0;
  try {
    const dbInfoResult = await pool.query(`SELECT current_database() as db_name, current_schema() as schema_name`);
    console.log(`🔍 Database Info: ${dbInfoResult.rows[0]?.db_name || 'unknown'} | Schema: ${dbInfoResult.rows[0]?.schema_name || 'unknown'}`);
    console.log(`🔍 Connection: ${process.env.POSTGRES_HOST || 'unknown'}:${process.env.POSTGRES_PORT || 5432} | DB: ${process.env.POSTGRES_DB || 'unknown'}`);

    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'plasticwastemanagement'
      ) as exists
    `);
    console.log(`🔍 Table exists: ${tableCheck.rows[0]?.exists ? 'YES' : 'NO'}`);

    const countResult = await pool.query(`SELECT COUNT(*) as count FROM plasticwastemanagement`);
    finalCount = parseInt(countResult.rows[0]?.count || 0);
    console.log(`📊 Final records in table: ${finalCount} (was ${initialCount}, added ${finalCount - initialCount})`);

    const sampleRecords = await pool.query(`
      SELECT reg_id, company_legal_name, created_on, synced_at 
      FROM plasticwastemanagement 
      ORDER BY synced_at DESC 
      LIMIT 5
    `);
    console.log(`🔍 Sample records (latest 5):`);
    if (sampleRecords.rows.length > 0) {
      sampleRecords.rows.forEach((record, idx) => {
        console.log(`   ${idx + 1}. reg_id: ${record.reg_id}, company: ${record.company_legal_name?.substring(0, 40) || 'N/A'}..., synced: ${record.synced_at}`);
      });
    } else {
      console.error(`   ❌ NO RECORDS FOUND IN TABLE!`);
    }

    if (rows.length > 0) {
      const testRegIds = rows.slice(0, 3).map(r => r.reg_id).filter(Boolean);
      if (testRegIds.length > 0) {
        const verifyResult = await pool.query(
          `SELECT reg_id, company_legal_name, synced_at FROM plasticwastemanagement WHERE reg_id = ANY($1)`,
          [testRegIds]
        );
        console.log(`🔍 Verification: Looking for ${testRegIds.length} test records, found ${verifyResult.rows.length}`);
        if (verifyResult.rows.length > 0) {
          verifyResult.rows.forEach(r => {
            console.log(`   ✅ Found: reg_id=${r.reg_id}, company=${r.company_legal_name?.substring(0, 30)}`);
          });
        } else {
          console.error(`   ❌ NONE of the test records found in table!`);
        }
      }
    }
  } catch (err) {
    console.error(`❌ Error checking final count:`, err.message);
    console.error(`❌ Error stack:`, err.stack);
  }

  console.log(`✅ Database save complete: ${inserted} inserted, ${updated} updated, ${errors} errors out of ${rows.length} total`);

  return { inserted, updated, errors };
}


export const searchNationalByLegalName = async (legalName) => {
  const normalized = normalizeText(legalName);

  const query = `
    SELECT *
    FROM plasticwastemanagement
    WHERE legal_name_normalized ILIKE '%' || $1 || '%'
    ORDER BY
      CASE applicant_type
        WHEN 'Brand Owner' THEN 1
        WHEN 'Producer' THEN 2
        WHEN 'Importer' THEN 3
        ELSE 4
      END
    LIMIT 1
  `;

  const { rows } = await pool.query(query, [normalized]);

  return rows[0] || null;
};