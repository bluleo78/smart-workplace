// 운영자 시드의 대상 가드(checkIsolatedApi) 시험 — 운영자 매뉴얼 스택(localhost:6166)에만 시드가 돌아야 한다(WP-1195).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkIsolatedApi, OPERATOR_STACK_API_PORT } from './lib/operator-seed.mjs';

test('checkIsolatedApi allows only localhost on the operator stack API port', () => {
  assert.equal(OPERATOR_STACK_API_PORT, '6166');
  assert.deepEqual(checkIsolatedApi('http://localhost:6166'), { ok: true });
  assert.deepEqual(checkIsolatedApi('http://127.0.0.1:6166/'), { ok: true });
  assert.deepEqual(checkIsolatedApi('http://[::1]:6166'), { ok: true });
});

test('checkIsolatedApi refuses other ports, including the shared dev API and the other isolated stack', () => {
  for (const url of ['http://localhost:6060', 'http://localhost:6160', 'http://localhost:7000', 'http://localhost']) {
    const r = checkIsolatedApi(url);
    assert.equal(r.ok, false, url);
    assert.match(r.reason, /6166/);
  }
});

test('checkIsolatedApi refuses remote hosts and bad urls', () => {
  assert.equal(checkIsolatedApi('https://genia-works.example.com:6166').ok, false);
  assert.equal(checkIsolatedApi('http://10.0.0.5:6166').ok, false);
  assert.equal(checkIsolatedApi('localhost:6166').ok, false); // 스킴이 없으면 호스트를 알 수 없다
  assert.equal(checkIsolatedApi('not a url').ok, false);
});
