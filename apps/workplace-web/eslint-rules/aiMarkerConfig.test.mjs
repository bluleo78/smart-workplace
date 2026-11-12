// WP-1529: AI 표식 규칙 두 개가 eslint.config.js 에 실제로 배선됐는지(켜짐·허용 목록 예외) 확인한다.
// 규칙 모듈 자체의 동작은 aiMarkerRules.test.mjs 가 보고, 여기서는 "설정이 규칙을 켰는가"만 본다.
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ESLint } from 'eslint'

const appRoot = path.resolve(import.meta.dirname, '..')
const eslint = new ESLint({ cwd: appRoot })

// 코드를 가상 경로로 린트해 나온 ruleId 목록을 돌려준다.
async function ruleIds(code, rel) {
  const [result] = await eslint.lintText(code, { filePath: path.join(appRoot, rel) })
  return result.messages.map((m) => m.ruleId)
}

const SPARKLES = "import { Sparkles } from 'lucide-react'\nexport const X = Sparkles\n"
const RAW_HUE = "export const c = 'text-violet-500'\n"

describe('ai-marker 규칙 배선', () => {
  // [설명, 코드, 가상 경로, 규칙 id, 걸려야 하는가]
  it.each([
    ['일반 경로에서 Sparkles 직접 import 는 걸린다', SPARKLES, 'src/pages/__probe__/Probe.tsx', 'ai-marker/no-direct-sparkles', true],
    ['components/ai 안에서는 Sparkles 를 허용한다', SPARKLES, 'src/components/ai/Probe.tsx', 'ai-marker/no-direct-sparkles', false],
    ['일반 경로의 원색 클래스는 걸린다', RAW_HUE, 'src/components/layout/Probe.tsx', 'ai-marker/no-raw-ai-hue', true],
    ['라벨 팔레트 파일은 원색을 허용한다', RAW_HUE, 'src/lib/labelColors.ts', 'ai-marker/no-raw-ai-hue', false],
    ['e2e 스펙은 원색을 허용한다', RAW_HUE, 'e2e/pages/x.spec.ts', 'ai-marker/no-raw-ai-hue', false],
    ['테스트 파일은 원색을 허용한다', RAW_HUE, 'src/pages/x.test.tsx', 'ai-marker/no-raw-ai-hue', false],
  ])('%s', async (_name, code, rel, rule, flagged) => {
    const ids = await ruleIds(code, rel)
    if (flagged) expect(ids).toContain(rule)
    else expect(ids).not.toContain(rule)
  }, 60_000)
})
