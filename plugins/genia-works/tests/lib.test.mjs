// mod 순수 함수 테스트 — $ 없이 node --test 로 돈다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKeyList, identityLabel, isKeyPath, END_CLEARS } from '../hooks/lib.js';

test('parseKeyList: 탭 구분 줄을 이름·등록일로', () => {
  assert.deepEqual(parseKeyList('ai-dev\t10-14\nai-review\t10-12\n'), [
    { name: 'ai-dev', added: '10-14' },
    { name: 'ai-review', added: '10-12' },
  ]);
  assert.deepEqual(parseKeyList(''), []);
});

test('identityLabel: 세션 선택 > GENIA_WORKS_AS > 환경변수 토큰 > 내 토큰', () => {
  assert.equal(identityLabel({ selected: 'ai-rev', as: 'ai-dev', hasEnvToken: true }), 'genia-works: ai-rev');
  assert.equal(identityLabel({ selected: 'me', as: 'ai-dev', hasEnvToken: true }), 'genia-works: 환경변수 토큰');
  assert.equal(identityLabel({ selected: 'me', as: 'ai-dev', hasEnvToken: false }), 'genia-works: 내 토큰');
  assert.equal(identityLabel({ as: 'ai-dev', hasEnvToken: false }), 'genia-works: ai-dev');
  assert.equal(identityLabel({ hasEnvToken: false }), 'genia-works: 내 토큰');
});

test('identityLabel: 고른 이름의 키가 없으면 안내 문구', () => {
  assert.equal(
    identityLabel({ selected: 'ghost', hasEnvToken: false, keyMissing: true }),
    'genia-works: ghost 키가 없습니다 — /genia-works:login',
  );
  assert.equal(identityLabel({ selected: 'ai-dev', hasEnvToken: false, keyMissing: false }), 'genia-works: ai-dev');
});

test('isKeyPath: 키 저장소 경로가 든 입력만', () => {
  assert.equal(isKeyPath('cat ~/.genia-works/keys/ai-dev'), true);
  assert.equal(isKeyPath('{"file_path":"/Users/a/.genia-works/keys/x"}'), true);
  assert.equal(isKeyPath('ls ~/.genia-works'), true);
  assert.equal(isKeyPath('grep genia-works README.md'), false);
});

test('END_CLEARS: clear·resume 에서는 선택을 지우지 않는다', () => {
  assert.equal(END_CLEARS.has('prompt_input_exit'), true);
  assert.equal(END_CLEARS.has('other'), true);
  assert.equal(END_CLEARS.has('clear'), false);
  assert.equal(END_CLEARS.has('resume'), false);
});
