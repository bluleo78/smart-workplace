#!/usr/bin/env node
// Codex PreToolUse hook(WP-1295) — gw-codex-loop 가 -c 로 건다. 키 저장소·헤더 스크립트에 닿는 도구 호출이면 이유를 stderr 에 쓰고 종료 2(막음),
// 아니면 0. 입력을 읽지 못해도 막지 않는다(hook 오류로 모든 도구가 멈추지 않게) — 막는 판정은 lib.mjs 의 guardDecision 한곳이다.
import { guardDecision } from './lib.mjs'

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => (raw += d))
process.stdin.on('end', () => {
  let input
  try {
    input = JSON.parse(raw)
  } catch {
    process.exit(0)
  }
  const reason = guardDecision(input)
  if (reason) {
    process.stderr.write(reason + '\n')
    process.exit(2)
  }
  process.exit(0)
})
