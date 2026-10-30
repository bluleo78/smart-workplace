// scene-kit 의 읽기 전용 가드 시험 — 실제 브라우저 없이 route 처리기를 가짜 요청으로 부른다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { blockedRequests, guardReadOnly, resetGuard } from './lib/scene-kit.mjs';

/** context.route 로 등록된 처리기를 잡아 두는 가짜 컨텍스트. */
function fakeContext() {
  const ctx = { handler: null, async route(_pattern, handler) { ctx.handler = handler; } };
  return ctx;
}

/** 처리기에 요청 하나를 흘려 보내 통과(fallback)인지 막힘(abort)인지 돌려준다. */
async function send(ctx, method, url) {
  let result = null;
  await ctx.handler({
    request: () => ({ method: () => method, url: () => url }),
    fallback: async () => { result = 'pass'; },
    abort: async () => { result = 'blocked'; },
  });
  return result;
}

test('guardReadOnly blocks writes but lets GET and auth through', async () => {
  const ctx = fakeContext();
  await guardReadOnly(ctx);
  assert.equal(await send(ctx, 'GET', 'https://x/api/v1/issues'), 'pass');
  assert.equal(await send(ctx, 'POST', 'https://x/api/v1/auth/refresh'), 'pass');
  assert.equal(await send(ctx, 'POST', 'https://x/api/v1/messaging/channels/1/read'), 'blocked');
  assert.ok(blockedRequests.includes('POST /api/v1/messaging/channels/1/read'));
});

test('guardReadOnly passes only writes an allowWrite added later approves', async () => {
  const ctx = fakeContext();
  await guardReadOnly(ctx);
  await guardReadOnly(ctx, { allowWrite: (m, url) => m === 'POST' && /\/drive-space$/.test(url) });
  assert.equal(await send(ctx, 'POST', 'https://x/api/v1/messaging/channels/54/drive-space'), 'pass');
  assert.equal(await send(ctx, 'POST', 'https://x/api/v1/messaging/channels/54/read'), 'blocked');
  assert.equal(await send(ctx, 'DELETE', 'https://x/api/v1/messaging/channels/54/drive-space'), 'blocked');
});

test('guardReadOnly applies the latest extraBlock regardless of call order', async () => {
  const ctx = fakeContext();
  await guardReadOnly(ctx, { extraBlock: (url) => /\/summary$/.test(url) });
  await guardReadOnly(ctx, { extraBlock: (url) => /\/catchup$/.test(url) });
  assert.equal(await send(ctx, 'GET', 'https://x/api/v1/wiki/pages/1/summary'), 'pass');
  assert.equal(await send(ctx, 'GET', 'https://x/api/v1/messaging/channels/1/catchup'), 'blocked');
});

test('allowRead opens one blocked GET for the scene and resetGuard closes it with allowWrite', async () => {
  const ctx = fakeContext();
  await guardReadOnly(ctx, { extraBlock: (url) => /\/(catchup|summary)$/.test(url) });
  await guardReadOnly(ctx, { allowRead: (url) => /\/catchup$/.test(url), allowWrite: (m, url) => m === 'POST' && /\/ai\/chat$/.test(url) });
  assert.equal(await send(ctx, 'GET', 'https://x/api/v1/messaging/channels/1/catchup'), 'pass');
  assert.equal(await send(ctx, 'GET', 'https://x/api/v1/wiki/pages/1/summary'), 'blocked');
  assert.equal(await send(ctx, 'POST', 'https://x/api/v1/ai/chat'), 'pass');
  resetGuard(ctx);
  assert.equal(await send(ctx, 'GET', 'https://x/api/v1/messaging/channels/1/catchup'), 'blocked');
  assert.equal(await send(ctx, 'POST', 'https://x/api/v1/ai/chat'), 'blocked');
});
