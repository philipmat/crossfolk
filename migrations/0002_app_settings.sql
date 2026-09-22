-- Runtime-tunable operator settings. These rows are edited in place (D1 console or
-- `wrangler d1 execute --remote`) so throttling can change without a redeploy.
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  updated_by TEXT
);

INSERT INTO app_settings (key, value_json, updated_at_ms, updated_by)
  VALUES ('ai_generation_policy', '{"mode":"unrestricted"}', 0, 'migration');
