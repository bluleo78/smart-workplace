// 업무 프로파일 러너 — 끝낸 이슈 목록을 받아 요약·역량 태그·이슈별 분류(task+area)를 만든다.
// 건수·비율 같은 숫자는 API 가 센다 — AI 는 문장과 분류만 낸다. 도구 없이 텍스트 in/out(runText).
import { z } from 'zod'
import { runText } from './run-messaging-ai.js'
import { firstJsonObject } from './json-extract.js'
import type { RunAgentDeps } from './run-agent.js'

// 요청 바디 스키마 — Spring 의 WorkProfileAiRequest 와 1:1. 100건 초과는 거절(프롬프트 크기 상한).
export const workProfileInputSchema = z.object({
  periodLabel: z.string(),
  issues: z
    .array(
      z.object({
        key: z.string(),
        title: z.string(),
        // 본문 없는 이슈는 null 로 올 수 있다 — 빈 문자열로 통일.
        body: z.string().nullish().transform((v) => v ?? ''),
        type: z.string().nullish(),
        labels: z.array(z.string()).default([]),
        epic: z.string().nullish(),
        project: z.string(),
        components: z.array(z.string()).default([]),
        lastComment: z.string().nullish(),
        dueResult: z.string(),
      }),
    )
    .max(100),
  assistantAgentId: z.number(),
  model: z.string(),
  maxTurns: z.number(),
  timeoutMs: z.number(),
})
export type WorkProfileInput = z.infer<typeof workProfileInputSchema>

// 이슈 분류용 고정 일 종류 9개 — 「·」 는 이름의 일부. 목록 밖 값은 '기타' 로 접는다.
export const WORK_PROFILE_TASKS = [
  '결함 수정',
  '기능 개발',
  '설계·기획',
  '릴리스·배포',
  '매뉴얼·문서',
  '테스트',
  '운영·지원',
  '개선·정리',
  '기타',
] as const

export interface WorkProfileResult {
  summary: string
  skills: string[]
  items: { key: string; task: string; area: string }[]
}

// 100건 분류 JSON 은 기본 파싱 상한(8,000자)에 모자라 넉넉히 잡는다.
const PARSE_MAX_CHARS = 20_000
const MAX_SKILLS = 5

// LLM 출력 스키마 — 세부 값(task·area·skills 원소)은 unknown 으로 받아 아래에서 정규화한다.
const OutputSchema = z.object({
  summary: z.string(),
  skills: z.array(z.unknown()),
  items: z.array(z.object({ key: z.string(), task: z.unknown(), area: z.unknown() })),
})

// 시스템 프롬프트 — JSON 만, 해요체 요약, 고정 task 목록, 숫자 생성 금지.
function buildSystemPrompt(periodLabel: string): string {
  return (
    '당신은 팀원의 업무 프로파일을 정리하는 도우미입니다.\n' +
    `아래는 한 사람이 ${periodLabel} 동안 끝낸 이슈들입니다. 다른 텍스트 없이 아래 JSON 만 반환하세요.\n\n` +
    '{\n' +
    '  "summary": "이 사람이 주로 무슨 일을 했는지 2~3문장",\n' +
    '  "skills": ["역량 태그"],\n' +
    '  "items": [{ "key": "WP-1", "task": "기능 개발", "area": "이슈 트래커" }]\n' +
    '}\n\n' +
    '규칙:\n' +
    '- summary 는 2~3문장, 해요체(~했어요, ~해요)로 쓴다.\n' +
    `- task 는 반드시 다음 중 하나: ${WORK_PROFILE_TASKS.join(', ')}. 애매하면 기타.\n` +
    '- area 는 일한 영역을 나타내는 짧은 명사. 구성요소·에픽·프로젝트 이름을 우선 쓴다.\n' +
    `- skills 는 짧은 명사로 최대 ${MAX_SKILLS}개.\n` +
    '- items 에는 입력된 모든 이슈를 key 그대로 한 번씩 넣는다.\n' +
    '- 건수·비율 같은 숫자는 만들지 않는다. 숫자는 시스템이 세므로 summary 에도 쓰지 않는다.'
  )
}

// 이슈 한 건을 한 덩어리 텍스트로 — 비어 있는 항목은 '(없음)'.
function formatIssue(i: WorkProfileInput['issues'][number]): string {
  const orNone = (v: string | null | undefined) => (v && v.trim() ? v : '(없음)')
  const list = (v: string[]) => (v.length > 0 ? v.join(', ') : '(없음)')
  return (
    `[${i.key}] ${i.title}\n` +
    `유형: ${orNone(i.type)} / 라벨: ${list(i.labels)} / 에픽: ${orNone(i.epic)} / ` +
    `프로젝트: ${i.project} / 구성요소: ${list(i.components)} / 기한 결과: ${i.dueResult}\n` +
    `본문: ${orNone(i.body)}\n` +
    `마지막 코멘트: ${orNone(i.lastComment)}`
  )
}

// 응답 파싱·정규화 — 형식이 깨졌으면 예외, 세부 값은 보정(목록 밖 task→기타, 모르는/중복 key 버림).
function parseResult(text: string, input: WorkProfileInput): WorkProfileResult {
  const obj = firstJsonObject(text, PARSE_MAX_CHARS)
  const parsed = obj ? OutputSchema.safeParse(obj) : null
  if (!parsed || !parsed.success) throw new Error('work_profile_parse_failed')

  const skills: string[] = []
  for (const s of parsed.data.skills) {
    if (typeof s !== 'string') continue
    const t = s.trim()
    if (t && !skills.includes(t)) skills.push(t)
    if (skills.length >= MAX_SKILLS) break
  }

  // 아직 결과에 넣지 않은 보낸 이슈 키 — 모르는 키와 두 번째 등장은 delete 가 false 라 함께 버린다.
  const remaining = new Set(input.issues.map((i) => i.key))
  const taskSet = new Set<string>(WORK_PROFILE_TASKS)
  const items: WorkProfileResult['items'] = []
  for (const it of parsed.data.items) {
    if (!remaining.delete(it.key)) continue
    const task = typeof it.task === 'string' && taskSet.has(it.task.trim()) ? it.task.trim() : '기타'
    const area = typeof it.area === 'string' ? it.area.trim() : ''
    items.push({ key: it.key, task, area })
  }
  return { summary: parsed.data.summary, skills, items }
}

/** 끝낸 이슈들 → 요약·역량 태그·이슈별 분류. 응답이 깨지면 work_profile_parse_failed 예외. */
export async function runWorkProfile(
  input: WorkProfileInput,
  deps: RunAgentDeps,
): Promise<WorkProfileResult> {
  const userMessage = input.issues.map(formatIssue).join('\n\n')
  const text = await runText(buildSystemPrompt(input.periodLabel), userMessage, input, deps, 'work-profile')
  return parseResult(text, input)
}
