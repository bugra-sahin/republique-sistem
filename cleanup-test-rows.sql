DELETE FROM section_views WHERE section LIKE 'PROD-%' OR section LIKE 'TEST-%';
SELECT kind, section, dwell_ms, table_name, created_at FROM section_views ORDER BY created_at DESC LIMIT 25;
