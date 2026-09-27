# Deployment

Crossfolk runs on Cloudflare Workers or in a Docker container using the local Node server. Both use the same portable
API core. Cloudflare needs a Workers account, a D1 database, and Wrangler access with Workers deployment and D1 Write
permissions. Custom themes need an OpenRouter key; per-requester limits need a hashing secret. Docker needs a persistent
volume for SQLite. Node installations require Node.js 22.13 or newer.

## Cloudflare Workers

`public/` is served as Workers Static Assets. `worker/index.js` handles `/api/words`; other Worker routes return a JSON
404. The `WORDS_LIMIT` binding in `wrangler.jsonc` allows 20 requests per minute per IP. AI generation has a separate
database-backed policy described below.

Create the D1 database and apply committed migrations before deploying:

```sh
npx wrangler d1 create crossfolk-db
npx wrangler d1 migrations apply crossfolk-db --local
npx wrangler d1 migrations apply crossfolk-db --remote
```

Put the returned `database_id` in `wrangler.jsonc` under the `APP_DB` binding. Then set the Worker secrets and deploy:

```sh
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put REQUESTER_HASH_SECRET
./scripts/deploy-cloudflare.sh
```

Set `OPENROUTER_SITE_URL` in the `vars` section of `wrangler.jsonc` to the primary public URL once known. It supplies
OpenRouter's required app-attribution header. Use `npx wrangler dev` for a local Worker smoke check before deploying.

### GitHub Actions

Pull requests run `npm run test`. Pushes and merges to `main` run [
`scripts/deploy-cloudflare.sh`](scripts/deploy-cloudflare.sh), which applies remote D1 migrations and deploys the Worker
and assets. Configure these repository secrets before enabling deployment:

| Secret                  | Purpose                                           |
|-------------------------|---------------------------------------------------|
| `CLOUDFLARE_API_TOKEN`  | Token with Workers deployment and D1 Write access |
| `CLOUDFLARE_ACCOUNT_ID` | Account that owns the Worker and D1 database      |

Store `OPENROUTER_API_KEY` and `REQUESTER_HASH_SECRET` as Worker runtime secrets, not GitHub Actions secrets. For a
manual deployment, authenticate with `npx wrangler login` or export the CI token and account ID, then run:

```sh
npm ci
./scripts/deploy-cloudflare.sh
```

## Docker

The image runs the Node server. Mount persistent storage for its SQLite database and pass the API key at runtime:

```sh
docker build -t crossfolk .
docker run --rm -p 3000:3000 -v crossfolk-data:/data \
  -e OPENROUTER_API_KEY \
  crossfolk
```

This forwards an already-exported `OPENROUTER_API_KEY`; use `-e OPENROUTER_API_KEY='your-key'` if needed. The image sets
`APP_DB_PATH=/data/crossfolk.sqlite` and makes `/data` writable by the unprivileged `node` user. Pass `PORT`,
`OPENROUTER_MODELS`, and `OPENROUTER_SITE_URL` with more `-e` flags as needed. Do not bake credentials into the image.

## AI generation

Ten curated theme families work without AI. Other themes need a server-side `OPENROUTER_API_KEY` and an enabled
`ai_generation_policy` row. Without a key, the API reports that AI generation is unconfigured. New databases start with
generation switched off. An OpenRouter account with API access is required, and calls incur usage charges. Theme text
and recently used answers go to OpenRouter; the key stays on the server.

For local development, put the key in the gitignored `.env` file or export it before `npm start`. `OPENROUTER_MODELS`
accepts a comma-separated preference order; the default is
`deepseek/deepseek-v4-flash,openai/gpt-5.6-luna,openai/gpt-4.1-mini`. Every model must support structured JSON schema
output. `OPENROUTER_MODEL` remains a single-model alias. The server tries the next model if one fails, times out, or
returns unusable output. Each model has up to 60 seconds; all attempts share a 120-second request budget. The server
logs each attempt's model, outcome, and duration, and AI puzzles show the answering model and total input/output tokens,
including discarded attempts.

### Generation policy

`app_settings.ai_generation_policy` controls the public AI budget at request time. Migration `0002_app_settings.sql`
initializes it to `off`. Each Worker isolate refreshes the policy within about 30 seconds, so changes need no redeploy.
Run these commands as the operator:

```sh
# Stop AI generation
npx wrangler d1 execute crossfolk-db --remote --command \
  "UPDATE app_settings SET value_json = '{\"mode\":\"off\"}', updated_at_ms = unixepoch() * 1000 WHERE key = 'ai_generation_policy'"

# Five generations per requester per hour, at least ten minutes apart; 500 per day overall
npx wrangler d1 execute crossfolk-db --remote --command \
  "UPDATE app_settings SET value_json = '{\"mode\":\"limited\",\"perRequester\":{\"limit\":5,\"windowSec\":3600,\"minIntervalSec\":600},\"global\":{\"limit\":500,\"windowSec\":86400}}', updated_at_ms = unixepoch() * 1000 WHERE key = 'ai_generation_policy'"

# No generation throttle
npx wrangler d1 execute crossfolk-db --remote --command \
  "UPDATE app_settings SET value_json = '{\"mode\":\"unrestricted\"}', updated_at_ms = unixepoch() * 1000 WHERE key = 'ai_generation_policy'"
```

| Field                    | Meaning                                                            |
|--------------------------|--------------------------------------------------------------------|
| `mode`                   | `off`, `limited`, or `unrestricted`                                |
| `perRequester`, `global` | Individual and shared rules; `limited` needs at least one          |
| `limit`, `windowSec`     | Maximum generations in a rolling window; `limit` needs `windowSec` |
| `minIntervalSec`         | Minimum gap between generations, usable alone                      |
| `message`                | Optional user-facing explanation                                   |

A `limit` of `0` blocks that scope. The requester rule is evaluated first. Malformed policy data is refused: the isolate
keeps its last valid policy, or uses `unrestricted` if it has never read one. Check edits with:

```sh
npx wrangler d1 execute crossfolk-db --remote --command "SELECT value_json FROM app_settings WHERE key = 'ai_generation_policy'"
```

The budget is charged once, when a new request row is created. Polls, retries, and lease recovery reuse that row. Denied
requests are stored as `throttled` but excluded from usage counts. Denials return `429` with `Retry-After`, or `503`
when the policy is `off`. `WORDS_LIMIT` remains a separate per-IP burst guard.

The Worker derives each requester key from an HMAC of the connecting IP using `REQUESTER_HASH_SECRET`. Without that
secret, all callers share `unknown`, so a per-requester rule behaves like another global rule. Local runs use the shared
key `local`.  
Generate a `REQUESTER_HASH_SECRET` using `openssl rand -hex 32`.

### Request records and privacy

Curated themes do not call the endpoint or create database records. An AI request has one browser-generated UUID.
Retries reuse its payload and UUID; a new-puzzle action creates a new one. Completed requests replay their stored
response. Active requests return `202` with `Retry-After`; expired leases can be reclaimed. The provider response is
checkpointed before parsing, though a narrow duplicate-call window remains before that checkpoint.

Records contain normalized inputs, model metadata, safe error categories, and bounded response text. They exclude API
keys, authorization headers, cookies, arbitrary headers, and raw IP addresses. Records remain until manually pruned.

### Investigation queries

Run the same SQL against local SQLite or D1 (`npx wrangler d1 execute crossfolk-db --remote --command "..."`):

```sql
-- Recent failures
SELECT id, started_at_ms, http_status, error_category, error_message
FROM ai_generation_requests
WHERE outcome != 'succeeded'
ORDER BY started_at_ms DESC LIMIT 25;

-- Attempts for one request
SELECT attempt_number, model, outcome, total_tokens, duration_ms, provider_request_id
FROM ai_generation_attempts
WHERE request_id = '<request-id>'
ORDER BY attempt_number;

-- Daily known token usage
SELECT date (started_at_ms / 1000, 'unixepoch') AS day, SUM (known_total_tokens) AS tokens
FROM ai_generation_requests
GROUP BY day
ORDER BY day DESC;

-- Active policy and recent denials
SELECT value_json, updated_at_ms
FROM app_settings
WHERE key = 'ai_generation_policy';
SELECT requester_key, error_category, COUNT(*) AS denials
FROM ai_generation_requests
WHERE outcome = 'throttled'
GROUP BY requester_key, error_category
ORDER BY denials DESC LIMIT 25;
```
