// 홈 우선순위 분류 러너 — 후보 목록을 LLM 에 보내 항목별 중요도·긴급도 점수(0~100)를 받는다.
// run-issue-classify-ai.ts 의 "runText 호출 → 그리디 JSON 추출 → zod 재검증 → 실패 시 폴백" 패턴을 미러한다.
import { z } from 'zod'
import { runText } from './run-messaging-ai.js'
import type { RunAgentDeps } from './run-agent.js'

// 개별 후보 항목 — 이슈 마감/멘션/드래프트 등 소스 종류를 가리지 않는다.
export interface PriorityClassifyItem {
  sourceType: string
  sourceId: string
  title: string
  context: string
}

export interface PriorityClassifyInput {
  items: PriorityClassifyItem[]
  assistantAgentId: number
  model: string
  maxTurns: number
  timeoutMs: number
}

export interface PriorityClassifyResult {
  sourceType: string
  sourceId: string
  importanceScore: number
  urgencyScore: number
  reason: string
}

// sourceId 는 4개의 독립된 BIGSERIAL 시퀀스(이슈/알림/메일/대화)에서 온 원시 PK 라 단독으로는 충돌한다
// (예: 이슈#1과 알림#1이 둘 다 sourceId="1"). sourceType 을 함께 반환하게 해 (sourceType, sourceId)
// 복합키로만 후보를 식별할 수 있게 한다 — Java 쪽 PriorityItemRepository.replaceForUser 의
// "sourceType:sourceId" 키 규약과 프론트 SynthesisLayer.tsx 매처가 이미 이 복합키를 쓴다.
const scoreLineSchema = z.object({
  sourceType: z.string(),
  sourceId: z.string(),
  importanceScore: z.number().int().min(0).max(100),
  urgencyScore: z.number().int().min(0).max(100),
  reason: z.string(),
})

const llmOutputSchema = z.object({ results: z.array(scoreLineSchema) })

const PRIORITY_CLASSIFY_SYSTEM_PROMPT =
  '아래 항목들을 하나씩 읽고 중요도(importanceScore)와 긴급도(urgencyScore)를 0~100 정수로 독립적으로 ' +
  '판단해. 소스 타입에 따라 고정된 순위를 매기지 말고 각 항목의 실제 내용(제목·맥락)을 근거로 판단해. ' +
  '각 항목마다 한국어 한 줄 근거(reason)도 함께 줘. sourceId 는 소스 타입마다 별개 채번이라 sourceId 만으로는 ' +
  '항목을 구분할 수 없으니, 결과 각 줄에 입력에 있던 sourceType 값을 그대로 반드시 포함해. ' +
  '다른 텍스트 없이 반드시 아래 JSON 형식만 반환:\n' +
  '{"results":[{"sourceType":"...","sourceId":"...","importanceScore":0,"urgencyScore":0,"reason":"..."}]}'

function buildUserMessage(items: PriorityClassifyItem[]): string {
  return items
    .map((it, i) => `${i + 1}. sourceId=${it.sourceId} type=${it.sourceType} title="${it.title}" context="${it.context}"`)
    .join('\n')
}

// LLM 텍스트에서 JSON 추출 → Zod 검증 → 실패 시 빈 결과 폴백(issue-classify/summary 폴백 패턴 미러).
// ⚠️ 빈 결과는 "점수 없음"으로 해석되며 호출부(홈 정렬)가 해당 항목을 후순위 처리하는 안전한 폴백이다.
export function parsePriorityClassifyJson(text: string): { results: PriorityClassifyResult[] } {
  const stripped = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '')
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    console.warn('[home-priority-classify] JSON 없음, 빈 결과 반환. text 앞:', text.slice(0, 80))
    return { results: [] }
  }
  try {
    const raw = JSON.parse(stripped.slice(start, end + 1)) as unknown
    const parsed = llmOutputSchema.safeParse(raw)
    if (!parsed.success) {
      console.warn('[home-priority-classify] Zod 검증 실패:', parsed.error.message)
      return { results: [] }
    }
    return parsed.data
  } catch (e) {
    console.warn('[home-priority-classify] JSON.parse 실패:', (e as Error).message)
    return { results: [] }
  }
}

/**
 * 후보 항목들을 LLM 에 보내 중요도·긴급도를 독립된 두 축으로 판단시킨다. 항목이 없으면 LLM 호출 없이
 * 빈 결과를 즉시 반환한다.
 */
export async function runHomePriorityClassify(
  input: PriorityClassifyInput,
  deps: RunAgentDeps,
): Promise<{ results: PriorityClassifyResult[] }> {
  if (input.items.length === 0) return { results: [] }

  const text = await runText(
    PRIORITY_CLASSIFY_SYSTEM_PROMPT,
    buildUserMessage(input.items),
    input,
    deps,
    'home-priority-classify',
  )
  return parsePriorityClassifyJson(text)
}
