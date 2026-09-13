import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('browser generation creates one immutable payload and reuses its UUID for bounded retries', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /const requestId=newRequestId\(\)/);
  assert.match(app, /Object\.freeze\(\{theme,size,difficulty,exclude:/);
  assert.match(app, /JSON\.stringify\(\{\.\.\.payload,requestId\}\)/);
  assert.match(app, /for\(let attempt=0;attempt<3;attempt\+\+\)/);
  assert.match(app, /response\.status===202\|\|data\.retryable===true/);
  assert.match(app, /value==null\?'unknown'/);
});
