// 릴리스 버전 비교·기준 태그 선택 검증(WP-440) — git·네트워크 없이 문자열만 본다. node --test deploy/release/tests 로 돈다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, compareVersions, isVersionTag, findBaseTag } from '../lib/semver.mjs';

test('parseVersion 은 major.minor.patch 만 받는다', () => {
  assert.deepEqual(parseVersion('0.9.0'), { major: 0, minor: 9, patch: 0 });
  assert.equal(parseVersion('v0.9.0'), null);
  assert.equal(parseVersion('0.9'), null);
  assert.equal(parseVersion('0.9.0-rc1'), null);
});

test('버전 비교는 숫자로 한다(문자열 비교 아님)', () => {
  assert.ok(compareVersions('0.10.0', '0.9.0') > 0);
  assert.ok(compareVersions('0.9.0', '0.10.0') < 0);
  assert.ok(compareVersions('1.0.0', '0.99.99') > 0);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.throws(() => compareVersions('1.2', '1.2.3'));
});

test('버전 태그는 v 접두 + 정확히 세 자리만 인정한다', () => {
  assert.equal(isVersionTag('v0.9.0'), true);
  for (const bad of ['v0.9', 'v0.9.0-rc1', '0.9.0', 'foo', 'v0.9.0.1', '']) {
    assert.equal(isVersionTag(bad), false, bad);
  }
});

test('기준 태그는 자기 자신을 뺀 조상 중 가장 높은 semver 다', () => {
  assert.equal(findBaseTag(['v0.8.0', 'v0.9.0', 'v0.9.1', 'foo'], 'v0.9.1'), 'v0.9.0');
  // 숫자 비교: v0.10.0 이 v0.9.0 보다 높다
  assert.equal(findBaseTag(['v0.9.0', 'v0.10.0'], 'v0.11.0'), 'v0.10.0');
});

test('자기보다 높은 조상 태그도 허용한다 — 핫픽스 기준은 조상 목록이 정한다', () => {
  assert.equal(findBaseTag(['v1.4.0', 'v1.5.0'], 'v1.5.1'), 'v1.5.0');
  assert.equal(findBaseTag(['v1.4.0', 'v1.6.0'], 'v1.5.1'), 'v1.6.0');
});

test('후보가 없으면 null 이다', () => {
  assert.equal(findBaseTag([], 'v0.1.0'), null);
  assert.equal(findBaseTag(['v0.1.0', 'foo'], 'v0.1.0'), null);
});
