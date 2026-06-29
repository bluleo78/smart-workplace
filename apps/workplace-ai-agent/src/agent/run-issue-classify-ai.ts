// 이슈 AI 분류 러너 — 제목+본문을 받아 유형·우선순위·라벨·이유를 추출한다.
// run-messaging-ai.ts 의 runText 패턴 미러. 도구 없이 텍스트 in/out.
import { z } from 'zod'
import { runText } from './run-messaging-ai.js'
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
  priority: z.enum(['LOW', 'MID', 'HIGH']),
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
    '  "priority": "LOW|MID|HIGH",\n' +
    '  "labels": ["라벨명"],              // projectLabels 목록 안에 있는 것만\n' +
    '  "reason": "한 문장 이유"\n' +
    '}\n\n' +
    '우선순위 기준:\n' +
    '- HIGH: 사용자 직접 영향, 데이터 손실, 서비스 중단 가능\n' +
    '- MID: 기능 제한, 불편하지만 우회 가능\n' +
    '- LOW: 개선사항, 문서, 정리\n\n' +
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
