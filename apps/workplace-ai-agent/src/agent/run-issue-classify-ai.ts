// 이슈 AI 분류 러너 — 제목+본문을 받아 유형·우선순위·라벨·이유를 추출한다.
// run-messaging-ai.ts 의 runText 패턴 미러. 도구 없이 텍스트 in/out.
import { z } from 'zod'
import { runText } from './run-messaging-ai.js'
import { normalizePriority } from './issue-priority.js'
import type { RunAgentDeps } from './run-agent.js'

// 이슈 분류 입력 스키마 — ai-agent /issue/classify 엔드포인트 요청 바디.
export const issueClassifyInputSchema = z.object({
  title: z.string(),
  // 본문 없는 이슈는 빈 문자열 허용.
  body: z.string(),
  // 프로젝트 실제 라벨 목록(백엔드가 DB에서 조회) — allowlist 로 사용.
  projectLabels: z.array(z.string()),
  // 개인 프로젝트면 type 필드를 요청/응답에서 생략(개인 프로젝트는 TASK 단일 유형).
  isPersonalProject: z.boolean(),
  assistantAgentId: z.number(),
  model: z.string(),
  maxTurns: z.number(),
  timeoutMs: z.number(),
})
export type IssueClassifyInput = z.infer<typeof issueClassifyInputSchema>

// LLM 출력 Zod 스키마 — greedy parse + safeParse 를 함께 사용.
const ClassifyResultSchema = z.object({
  type: z.enum(['TASK', 'BUG', 'STORY', 'CHORE']).optional(),
  // 우선순위 5단계(WP-886). 모르는 값이면 이 필드만 MID 로 — 예전엔 전체가 폴백돼 유형·라벨 제안까지 잃었다.
  // 모델이 소문자·공백으로 적어도("highest") 살리도록 normalizePriority(trim+대문자, mail-parser 와 공용)로 정규화한다.
  priority: z.unknown().transform(normalizePriority),
  labels: z.array(z.string()),
  reason: z.string(),
})
export type IssueClassifyResult = z.infer<typeof ClassifyResultSchema>

// 파싱 실패 시 반환할 폴백 — 폼 동작을 막지 않는다.
const CLASSIFY_FALLBACK: IssueClassifyResult = {
  type: undefined,
  priority: 'MID',
  labels: [],
  reason: '',
}

// 이슈 분류 시스템 프롬프트.
// isPersonalProject=true 면 type 관련 지시를 제거한 버전을 사용.
function buildClassifyPrompt(projectLabels: string[], isPersonalProject: boolean): string {
  const labelList = projectLabels.length > 0 ? projectLabels.join(', ') : '(없음)'
  const typeBlock = isPersonalProject
    ? ''
    : `  "type": "TASK|BUG|STORY|CHORE",   // 아래 유형 기준 참고\n`
  return (
    '당신은 이슈 트래커의 분류 전문가입니다.\n' +
    '제목과 본문을 읽고 아래 JSON만 반환하세요. 다른 텍스트 없이.\n\n' +
    '{\n' +
    typeBlock +
    '  "priority": "HIGHEST|HIGH|MID|LOW|LOWEST",\n' +
    '  "labels": ["라벨명"],              // projectLabels 목록 안에 있는 것만\n' +
    '  "reason": "한 문장 이유"\n' +
    '}\n\n' +
    // WP-886: 5단계. HIGHEST 는 긴급 건만 — 남용하면 「높음」과 따로 거르는 의미가 없어져 드물게 쓰라고 못 박는다.
    '우선순위 기준(애매하면 한 단계 낮게):\n' +
    '- HIGHEST: 운영 장애·보안 취약점·데이터 손실처럼 지금 바로 처리해야 하는 긴급 건만. 드물게 쓴다\n' +
    '- HIGH: 사용자에게 직접 영향, 주요 기능 오동작으로 우회가 어려움\n' +
    '- MID: 기능 제한, 불편하지만 우회 가능(기본)\n' +
    '- LOW: 개선사항, 문서, 정리\n' +
    '- LOWEST: 급하지 않은 아이디어·사소한 다듬기, 여유 있을 때 처리\n\n' +
    (!isPersonalProject
      ? '유형 기준:\n' +
        '- BUG: 오동작, 오류, 예상과 다른 동작\n' +
        '- STORY: 사용자 스토리, 신규 기능 요청\n' +
        '- CHORE: 리팩터링, 의존성 업데이트, 설정 변경\n' +
        '- TASK: 위에 해당 없는 작업\n\n'
      : '') +
    `라벨은 반드시 다음 목록 안에서만 선택: ${labelList}\n` +
    '목록이 비어 있으면 labels: [] 반환.'
  )
}

// LLM 텍스트에서 JSON 추출 → Zod 검증 → 라벨 allowlist 필터 → fallback.
// ⚠️ greedy regex 사용 — 중첩 구조 안전. non-greedy 는 첫 } 에서 끊겨 실패.
function parseClassifyResult(
  text: string,
  projectLabels: string[],
): IssueClassifyResult {
  // 코드펜스 제거
  const stripped = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '')
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    console.warn('[issue-classify] JSON 없음, fallback 반환. text 앞:', text.slice(0, 80))
    return CLASSIFY_FALLBACK
  }
  try {
    const raw = JSON.parse(stripped.slice(start, end + 1)) as unknown
    const parsed = ClassifyResultSchema.safeParse(raw)
    if (!parsed.success) {
      console.warn('[issue-classify] Zod 실패:', parsed.error.message)
      return CLASSIFY_FALLBACK
    }
    // 라벨 allowlist 교차검증 — 환각 라벨 제거.
    const allowSet = new Set(projectLabels)
    const filteredLabels = parsed.data.labels.filter((l) => allowSet.has(l))
    return { ...parsed.data, labels: filteredLabels }
  } catch (e) {
    console.warn('[issue-classify] JSON.parse 실패:', (e as Error).message)
    return CLASSIFY_FALLBACK
  }
}

/**
 * 이슈 분류: 제목+본문 → 유형·우선순위·라벨·이유.
 * run-messaging-ai.runMessagingClassify 미러.
 */
export async function runIssueClassify(
  input: IssueClassifyInput,
  deps: RunAgentDeps,
): Promise<IssueClassifyResult> {
  const systemPrompt = buildClassifyPrompt(input.projectLabels, input.isPersonalProject)
  const userMessage = `제목: ${input.title}\n본문: ${input.body || '(없음)'}`
  const text = await runText(systemPrompt, userMessage, input, deps, 'issue-classify')
  return parseClassifyResult(text, input.projectLabels)
}
