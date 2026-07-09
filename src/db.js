const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://republique:password@localhost:5432/republique',
});

// Tabloyu otomatik oluştur
async function initDb() {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS scans (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        rep_id VARCHAR(255),
        fbp VARCHAR(255),
        fbc VARCHAR(255),
        masa VARCHAR(50),
        utm_source VARCHAR(100),
        utm_medium VARCHAR(100),
        utm_campaign VARCHAR(255),
        utm_content VARCHAR(255),
        utm_term VARCHAR(255),
        fbclid VARCHAR(255),
        user_agent TEXT,
        ip VARCHAR(45)
      );

      CREATE TABLE IF NOT EXISTS ad_rules (
        id SERIAL PRIMARY KEY,
        max_cpa NUMERIC(10, 2) DEFAULT 200.00,
        min_roas NUMERIC(10, 2) DEFAULT 2.00,
        pause_if_no_purchase_after_days INTEGER DEFAULT 3,
        ask_approval_for_average BOOLEAN DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS ad_actions_log (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        action_type VARCHAR(100),
        ad_id VARCHAR(255),
        ad_name VARCHAR(255),
        status VARCHAR(50), -- PENDING, APPROVED, REJECTED, EXECUTED
        details JSONB
      );

      CREATE TABLE IF NOT EXISTS audience_syncs (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        audience_type VARCHAR(100),
        count INTEGER,
        status VARCHAR(50),
        details JSONB
      );
    `;
    await pool.query(query);
    console.log('Postgres "scans" ve "ads_management" tabloları hazır.');
  } catch (err) {
    console.error('Postgres tablo oluşturma hatası:', err);
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  initDb
};
