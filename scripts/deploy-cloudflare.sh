#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

wrangler=./node_modules/.bin/wrangler
if [ ! -x "$wrangler" ]; then
  echo 'Wrangler is not installed. Run npm ci first.' >&2
  exit 1
fi

"$wrangler" d1 migrations apply crossfolk-db --remote
"$wrangler" deploy
