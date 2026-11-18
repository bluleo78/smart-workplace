// scripts/agent-token-usage.mjs 단위 테스트 (WP-1714) — `node --test scripts/agent-token-usage.test.mjs`
// 같은 (message.id, requestId) 중복 제거·user 줄 무시·하위(subagents/isSidechain) 구분·집계 값을 본다.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { readRows, summarize } from './agent-token-usage.mjs'

/** assistant 줄 하나(JSON 한 줄)를 만든다. */
function assistant(id, requestId, cacheRead, extra = {}) {
  return JSON.stringify({
    type: 'assistant',
    requestId,
    timestamp: '2026-11-18T01:02:03.000Z',
    message: { id, usage: { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: cacheRead, output_tokens: 5 } },
    ...extra,
  })
}

/** 임시 폴더에 파일(상대 경로 → 줄 배열)을 쓰고 폴더 경로를 돌려준다. */
function makeDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-token-usage-'))
  for (const [rel, lines] of Object.entries(files)) {
    const p = path.join(dir, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, lines.join('\n') + '\n')
  }
  return dir
}

test('중복 줄은 한 번만 세고 user 줄은 무시한다', () => {
  const dir = makeDir({
    'a/projects/x/s.jsonl': [
      assistant('m1', 'r1', 100),
      assistant('m1', 'r1', 100),
      assistant('m2', 'r2', 300),
      JSON.stringify({ type: 'user', timestamp: '2026-11-18T01:00:00.000Z', message: { content: 'hi' } }),
      '깨진 줄',
    ],
  })
  assert.deepEqual(summarize(readRows(dir)), [
    { name: 'a', day: '2026-11-18', sub: false, calls: 2, avgContext: 203, cacheRead: 400, output: 10 },
  ])
})

test('subagents 경로 또는 isSidechain 줄은 하위로 나눈다', () => {
  const dir = makeDir({
    'a/projects/x/main.jsonl': [assistant('m1', 'r1', 10), assistant('m2', 'r2', 10, { isSidechain: true })],
    'a/projects/x/subagents/agent-1.jsonl': [assistant('m3', 'r3', 10)],
  })
  const out = summarize(readRows(dir))
  assert.deepEqual(out.map((r) => [r.sub, r.calls]), [[false, 1], [true, 2]])
})

test('중복 줄은 output_tokens 가 가장 큰 쪽을 남긴다(스트리밍 앞 줄은 일부일 수 있다)', () => {
  const withOut = (out) => assistant('m1', 'r1', 100).replace('"output_tokens":5', `"output_tokens":${out}`)
  const dir = makeDir({ 'a/projects/x/s.jsonl': [withOut(3), withOut(40), withOut(7)] })
  assert.deepEqual(summarize(readRows(dir)), [
    { name: 'a', day: '2026-11-18', sub: false, calls: 1, avgContext: 103, cacheRead: 100, output: 40 },
  ])
})
