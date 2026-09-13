CREATE TABLE ai_generation_requests (
  id TEXT PRIMARY KEY,
  started_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER,
  duration_ms INTEGER,
  runtime TEXT NOT NULL,
  requester_key TEXT NOT NULL,
  requester_key_version TEXT NOT NULL DEFAULT 'v1',
  theme TEXT,
  theme_key TEXT NOT NULL DEFAULT '',
  size INTEGER,
  difficulty TEXT,
  exclude_count INTEGER NOT NULL DEFAULT 0,
  request_json TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  configured_models_json TEXT NOT NULL,
  outcome TEXT NOT NULL,
  lease_token TEXT,
  lease_expires_at_ms INTEGER,
  recovery_count INTEGER NOT NULL DEFAULT 0,
  last_reclaimed_at_ms INTEGER,
  http_status INTEGER,
  error_category TEXT,
  error_message TEXT,
  selected_model TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  result_word_count INTEGER,
  response_json TEXT,
  known_input_tokens INTEGER,
  known_output_tokens INTEGER,
  known_total_tokens INTEGER,
  usage_complete INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE ai_generation_attempts (
  id INTEGER PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES ai_generation_requests(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  model TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER,
  duration_ms INTEGER,
  outcome TEXT NOT NULL,
  provider_http_status INTEGER,
  provider_request_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  usable_word_count INTEGER,
  request_json TEXT NOT NULL,
  provider_response_body TEXT,
  response_received_at_ms INTEGER,
  error_category TEXT,
  error_message TEXT,
  UNIQUE (request_id, attempt_number)
);

CREATE INDEX idx_ai_generation_requests_requester_started
  ON ai_generation_requests (requester_key, started_at_ms);
CREATE INDEX idx_ai_generation_requests_requester_theme_started
  ON ai_generation_requests (requester_key, theme_key, size, difficulty, started_at_ms);
CREATE INDEX idx_ai_generation_requests_theme_started
  ON ai_generation_requests (theme_key, size, difficulty, started_at_ms);
CREATE INDEX idx_ai_generation_requests_started
  ON ai_generation_requests (started_at_ms);
CREATE INDEX idx_ai_generation_requests_outcome_started
  ON ai_generation_requests (outcome, started_at_ms);
CREATE INDEX idx_ai_generation_attempts_model_started
  ON ai_generation_attempts (model, started_at_ms);
CREATE INDEX idx_ai_generation_attempts_started
  ON ai_generation_attempts (started_at_ms);
CREATE INDEX idx_ai_generation_attempts_outcome_started
  ON ai_generation_attempts (outcome, started_at_ms);
CREATE INDEX idx_ai_generation_attempts_request
  ON ai_generation_attempts (request_id, attempt_number);
