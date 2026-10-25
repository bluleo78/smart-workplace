#!/usr/bin/env node
// pre-push E2E 결과에서 재시도로 통과한(flaky) 테스트를 누적 기록한다 (WP-225).
// 게이트는 retries 로 flaky 를 삼켜 통과시키므로, 기록이 없으면 같은 스펙이 반복해 흔들려도 드러나지 않는다.
// 누적 파일을 보고 자주 등장하는 스펙부터 고친다.
//
// 사용: node scripts/e2e-flaky-record.mjs <playwright-json-report> <누적-로그-파일>
// 로그 형식(TSV): 기록시각 \t 커밋 \t 파일:줄 \t 테스트 제목 \t 첫 실패 사유
// 사유는 첫 시도의 오류 첫 줄과 실패한 줄 번호다 — 재시도가 통과하면 트레이스가 지워져 나중엔 원인을 볼 길이 없다.
import { execSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'

const [reportPath, logPath] = process.argv.slice(2)
if (!reportPath || !logPath) {
  console.error('사용: node scripts/e2e-flaky-record.mjs <report.json> <log>')
  process.exit(2)
}
// 실행이 중간에 깨져 리포트가 없으면 기록할 것도 없다 — 게이트 결과는 호출부가 판정한다.
if (!existsSync(reportPath)) process.exit(0)

const report = JSON.parse(readFileSync(reportPath, 'utf8'))

/** 첫 실패 시도의 오류를 한 줄로 줄인다(색 코드·줄바꿈·탭 제거, 실패한 줄 번호 덧붙임). */
function firstFailure(tests) {
  for (const t of tests ?? []) {
    const r = t.results?.find((x) => x.status !== 'passed' && x.status !== 'skipped')
    if (!r) continue
    const err = r.error ?? r.errors?.[0]
    // eslint-disable-next-line no-control-regex
    const msg = (err?.message ?? r.status).replace(/\u001b\[[0-9;]*m/g, '')
    // 첫 줄(무엇이 실패했나)과 Locator·Expected·Received·Timeout 줄(무엇을 기대했고 무엇이 왔나)만 남긴다.
    const lines = msg.split('\n').map((l) => l.trim()).filter(Boolean)
    const picked = [lines[0], ...lines.slice(1).filter((l) => /^(Locator|Expected|Received|Timeout)\b/.test(l))]
    const at = err?.location?.line ? ` @${err.location.line}` : ''
    return `${picked.join(' | ').replace(/\t/g, ' ').slice(0, 400)}${at}`
  }
  return ''
}

/** 중첩 suite 를 펼쳐 status 가 flaky 인 테스트만 모은다. */
function collectFlaky(suites, out = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      if (spec.tests?.some((t) => t.status === 'flaky')) {
        out.push({ where: `${spec.file}:${spec.line}`, title: spec.title, reason: firstFailure(spec.tests) })
      }
    }
    collectFlaky(suite.suites, out)
  }
  return out
}

const flaky = collectFlaky(report.suites)
if (flaky.length === 0) process.exit(0)

let sha = ''
try {
  sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
} catch {
  // 커밋 식별은 부가 정보 — 못 구해도 기록은 남긴다.
}
const now = new Date().toISOString()
appendFileSync(logPath, flaky.map((f) => `${now}\t${sha}\t${f.where}\t${f.title}\t${f.reason}\n`).join(''))

console.log(`[e2e-flaky] 재시도로 통과한 테스트 ${flaky.length}건 — ${logPath} 에 기록`)
for (const f of flaky) console.log(`  ${f.where}  ${f.title}${f.reason ? `\n    ↳ ${f.reason}` : ''}`)
