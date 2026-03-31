import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

const sslEnabled = process.env.POSTGRES_SSL === "true";
const sslConfig = sslEnabled ? { rejectUnauthorized: false } : false;

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig,
    })
  : new Pool({
      host: process.env.POSTGRES_HOST,
      port: process.env.POSTGRES_PORT,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
      ssl: sslConfig,
    });

pool
  .connect()
  .then(() => {
    console.log("✅ PostgreSQL connected successfully");
  })
  .catch((err) => {
    console.error("❌ PostgreSQL connection error:", err.message);
  });

  export default pool;