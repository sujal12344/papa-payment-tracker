import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const postgresUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!postgresUrl) {
  console.error("⚠️ DATABASE_URL nahi mila! Kripya .env me DATABASE_URL set karein.");
}

export const isPostgres = true;

// Create hosted PostgreSQL connection pool
export const pgPool = new pg.Pool({
  connectionString: postgresUrl,
  ssl: postgresUrl && !postgresUrl.includes("localhost") ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000
});

// Auto-initialize PostgreSQL tables and indexes
export async function initDb() {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id VARCHAR(255) PRIMARY KEY,
        amount NUMERIC(12, 2) NOT NULL,
        direction VARCHAR(16) NOT NULL,
        payer_name VARCHAR(255),
        sender_id VARCHAR(64),
        timestamp BIGINT NOT NULL,
        transaction_id VARCHAR(128),
        raw_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_payments_timestamp ON payments(timestamp);
    `);
    console.log("✅ Hosted PostgreSQL connected & schema ready!");
  } catch (err) {
    console.error("❌ PostgreSQL init error:", err.message);
  }
}

// Run init
initDb();

/**
 * Saves incoming parsed payments to PostgreSQL, returns how many were newly inserted
 */
export async function savePayments(payments) {
  let newCount = 0;
  const now = new Date().toISOString();

  for (const p of payments) {
    const id = p.id || p.transactionId || `${p.senderId}-${p.timestamp}-${p.amount}`;
    try {
      const res = await pgPool.query(
        `INSERT INTO payments (
          id, amount, direction, payer_name, sender_id, timestamp, transaction_id, raw_message, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO NOTHING`,
        [
          id,
          p.amount,
          p.direction,
          p.payerName || "Customer",
          p.senderId || "",
          p.timestamp,
          p.transactionId || null,
          p.rawMessage || "",
          now
        ]
      );
      if (res.rowCount > 0) newCount++;
    } catch (err) {
      console.error("PostgreSQL insert error:", err.message);
    }
  }

  return newCount;
}

/**
 * Returns all stored payments from PostgreSQL
 */
export async function getAllStoredPayments() {
  try {
    const res = await pgPool.query(`
      SELECT 
        id, 
        amount::float as amount, 
        direction, 
        payer_name as "payerName", 
        sender_id as "senderId", 
        timestamp::bigint as timestamp, 
        transaction_id as "transactionId", 
        raw_message as "rawMessage", 
        created_at as "createdAt"
      FROM payments 
      ORDER BY timestamp DESC 
      LIMIT 300
    `);
    return res.rows.map((r) => ({
      ...r,
      timestamp: Number(r.timestamp)
    }));
  } catch (err) {
    console.error("PostgreSQL select error:", err.message);
    return [];
  }
}

/**
 * Gets payments for a given timestamp range from PostgreSQL
 */
export async function getPaymentsByDateRange(start, end) {
  try {
    const res = await pgPool.query(
      `
      SELECT 
        id, 
        amount::float as amount, 
        direction, 
        payer_name as "payerName", 
        sender_id as "senderId", 
        timestamp::bigint as timestamp, 
        transaction_id as "transactionId", 
        raw_message as "rawMessage", 
        created_at as "createdAt"
      FROM payments 
      WHERE timestamp >= $1 AND timestamp < $2
      ORDER BY timestamp DESC
    `,
      [start, end]
    );
    return res.rows.map((r) => ({
      ...r,
      timestamp: Number(r.timestamp)
    }));
  } catch (err) {
    console.error("PostgreSQL range query error:", err.message);
    return [];
  }
}
