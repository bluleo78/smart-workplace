// scripts/vite-app-version.mjs 단위 테스트 (WP-439) — `node --test scripts/vite-app-version.test.mjs`
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { appVersionDefine, versionJsonPlugin } from './vite-app-version.mjs'

test('환경변수가 없으면 두 상수 모두 "dev" 로 정의한다', () => {
  assert.deepEqual(appVersionDefine({}), {
    __APP_VERSION__: '"dev"',
    __APP_VERSION_LABEL__: '"dev"',
    __GIT_SHA_SHORT__: '""',
  })
})

test('빈 문자열·공백도 없는 값으로 보고 "dev" 를 쓴다', () => {
  assert.deepEqual(appVersionDefine({ APP_VERSION: '', GIT_SHA: '  ' }), {
    __APP_VERSION__: '"dev"',
    __APP_VERSION_LABEL__: '"dev"',
    __GIT_SHA_SHORT__: '""',
  })
})

test('APP_VERSION·GIT_SHA 를 JSON 문자열 리터럴로 정의한다', () => {
  assert.deepEqual(appVersionDefine({ APP_VERSION: '0.9.0', GIT_SHA: 'a5d66d0e1234' }), {
    __APP_VERSION__: '"0.9.0"',
    __APP_VERSION_LABEL__: '"v0.9.0"',
    __GIT_SHA_SHORT__: '"a5d66d0"',
  })
})

test('APP_VERSION 맨 앞의 v/V 한 개는 떼어 낸다 (v0.9.0 → 0.9.0)', () => {
  assert.equal(appVersionDefine({ APP_VERSION: 'v0.9.0' }).__APP_VERSION__, '"0.9.0"')
  assert.equal(appVersionDefine({ APP_VERSION: 'V0.9.0' }).__APP_VERSION__, '"0.9.0"')
  assert.equal(appVersionDefine({ APP_VERSION: 'v0.9.0' }).__APP_VERSION_LABEL__, '"v0.9.0"')
  // 한 개만 뗀다 — 이중 접두사는 그대로 두어 잘못된 입력이 조용히 고쳐지지 않게 한다.
  assert.equal(appVersionDefine({ APP_VERSION: 'vv0.9.0' }).__APP_VERSION__, '"v0.9.0"')
})

test('짧은 커밋은 앞 7자이고, 7자보다 짧으면 그대로 둔다', () => {
  assert.equal(appVersionDefine({ GIT_SHA: 'abc' }).__GIT_SHA_SHORT__, '"abc"')
  assert.equal(appVersionDefine({ GIT_SHA: 'a5d66d0e1234' }).__GIT_SHA_SHORT__, '"a5d66d0"')
})

test('버전은 있고 커밋만 없으면 라벨은 v 버전, 짧은 커밋은 빈 문자열이다', () => {
  const d = appVersionDefine({ APP_VERSION: '1.2.3' })
  assert.equal(d.__APP_VERSION_LABEL__, '"v1.2.3"')
  assert.equal(d.__GIT_SHA_SHORT__, '""')
})

test('versionJsonPlugin 은 generateBundle 에서 version.json 자산을 emit 한다', () => {
  const emitted = []
  const plugin = versionJsonPlugin({ APP_VERSION: '0.9.0', GIT_SHA: 'x' })
  plugin.generateBundle.call({ emitFile: (f) => emitted.push(f) })
  assert.deepEqual(emitted, [
    { type: 'asset', fileName: 'version.json', source: '{"version":"0.9.0","commit":"x"}' },
  ])
})

test('versionJsonPlugin 도 값이 없으면 dev 를 담는다', () => {
  const emitted = []
  versionJsonPlugin({}).generateBundle.call({ emitFile: (f) => emitted.push(f) })
  assert.equal(emitted[0].source, '{"version":"dev","commit":"dev"}')
})

test('versionJsonPlugin 도 v 접두사를 떼어 version.json 에 쓴다', () => {
  const emitted = []
  versionJsonPlugin({ APP_VERSION: 'v0.9.0', GIT_SHA: 'x' }).generateBundle.call({ emitFile: (f) => emitted.push(f) })
  assert.equal(emitted[0].source, '{"version":"0.9.0","commit":"x"}')
})
