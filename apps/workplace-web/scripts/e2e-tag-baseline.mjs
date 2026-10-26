// E2E 판정 태그 기준선 갱신(WP-971) — 파일별 「태그 없는 테스트 수」를 e2e/untagged-baseline.json 에 다시 쓴다.
// 이관으로 태그를 달거나 테스트를 옮긴 뒤 실행해 기준선을 낮춘다. 기준선을 올리는 데 쓰지 않는다(새 테스트엔 태그를 단다).
// 사용: apps/workplace-web 에서 `pnpm e2e:tag-baseline` (--check: 쓰지 않고 지금 수와 기준선이 다르면 실패)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ESLint } from 'eslint'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = path.join(root, 'e2e/untagged-baseline.json')

// 기준선 없이(모두 0건 허용) 규칙만 돌려 파일별 위반 수를 센다.
const eslint = new ESLint({
  cwd: root,
  overrideConfig: [{ files: ['e2e/**/*.ts'], rules: { 'e2e/require-reason-tag': ['error', { baseline: {} }] } }],
})
const results = await eslint.lintFiles(['e2e/**/*.spec.ts'])
const counts = {}
for (const r of results) {
  const n = r.messages.filter((m) => m.ruleId === 'e2e/require-reason-tag').length
  if (n) counts[path.relative(root, r.filePath).split(path.sep).join('/')] = n
}
const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
const total = Object.values(sorted).reduce((a, b) => a + b, 0)

if (process.argv.includes('--check')) {
  const current = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  const same = JSON.stringify(current) === JSON.stringify(sorted)
  console.log(same ? `기준선 일치 — 태그 없는 E2E ${total}건` : '기준선이 지금과 다릅니다 — pnpm e2e:tag-baseline 으로 갱신하세요')
  process.exit(same ? 0 : 1)
}
fs.writeFileSync(baselinePath, JSON.stringify(sorted, null, 2) + '\n')
console.log(`e2e/untagged-baseline.json 갱신 — ${Object.keys(sorted).length}개 파일, 태그 없는 E2E ${total}건`)
