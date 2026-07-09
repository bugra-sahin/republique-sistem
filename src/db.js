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
    `;
    await pool.query(query);
    console.log('Postgres "scans" tablosu hazır.');
  } catch (err) {
    console.error('Postgres tablo oluşturma hatası:', err);
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  initDb
};
