// 리포트 러너 공유 조각(WP-1486) — 프로젝트 리포트(WP-1483 run-project-report)와 개인 보고 러너가 함께 쓰는
// 이슈 스키마·표 행 스키마·한 줄 정리·이슈 한 줄·출력 정리. 두 러너가 같은 모양으로 이슈를 싣고 같은 규칙으로 출력을 거르게 한 곳에 둔다.
import { z } from 'zod'

// 프로젝트 리포트가 이슈를 고르는 이유 — 기한 지남·기간 안 완료·기간 안 생김.
export const projectReasonSchema = z.enum(['OVERDUE', 'DONE', 'CREATED'])

// 이슈 한 건(공용 바탕) — Spring ReportIssue 와 1:1. 없을 수 있는 값은 null. 프로젝트 리포트는 이 모양 그대로 받고,
// 개인 보고는 이유를 넓히고 개인 전용 값(프로젝트·늦은 날수·AI와 함께)을 덧붙여 확장한다(run-personal-report).
export const reportIssueSchema = z.object({
  key: z.string(),
  url: z.string(),
  title: z.string(),
  statusName: z.string(),
  category: z.string(),
  assignees: z.array(z.string()),
  epic: z.string().nullish(),
  dueDate: z.string().nullish(),
  lastComment: z.string().nullish(),
  reason: projectReasonSchema,
})
export type ReportIssueInput = z.infer<typeof reportIssueSchema>

// 이슈 선정 이유 → 말. 개인 보고 이유(상태 바꿈·답 기다림·오늘 마감·진행 중)까지 한 표에 둔다.
export type ReportReason = ReportIssueInput['reason'] | 'STATUS_CHANGED' | 'WAITING' | 'DUE_TODAY' | 'OPEN'
export const REASON_LABEL: Record<ReportReason, string> = {
  OVERDUE: '기한 지남',
  DONE: '이번 기간에 완료',
  CREATED: '이번 기간에 새로 생김',
  STATUS_CHANGED: '이번 기간에 상태를 바꿈',
  WAITING: '내 답을 기다림',
  DUE_TODAY: '오늘 마감',
  OPEN: '진행 중',
}

// 비교·변화 표 행 — Spring ReportTableRow 와 1:1. 두 러너가 같은 모양으로 받는다.
export const tableRowSchema = z.object({ label: z.string(), current: z.string(), change: z.string() })

// 사람이 쓴 값을 한 줄로 — 줄바꿈·꺾쇠를 정리해 표지를 닫거나 새 규칙 줄을 끼우지 못하게 한다.
// (text-format.ts 의 oneLine 과 이름이 겹치지 않게 sanitizeInline 으로 둔다.)
export function sanitizeInline(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/[<>]/g, (c) => (c === '<' ? '＜' : '＞')).replace(/\s+/g, ' ').trim()
}

// formatIssue 가 받는 이슈 — 공용 바탕에 이유만 개인 보고까지 넓힌 모양.
type FormattableIssue = Omit<ReportIssueInput, 'reason'> & { reason: ReportReason }

// 이슈 한 줄 — 키·url·제목·상태·담당·에픽·기한·선정 이유(+ 호출자가 준 덧붙임 칸)·마지막 댓글.
// extras 는 개인 보고가 프로젝트·늦은 날수·AI와 함께를 끼우는 자리다 — 프로젝트 리포트는 넘기지 않아 예전 줄과 같다.
export function formatIssue(i: FormattableIssue, extras: string[] = []): string {
  const parts = [
    `- ${i.key} ${i.url}`,
    `제목: <issue>${sanitizeInline(i.title)}</issue>`,
    `상태: ${sanitizeInline(i.statusName)}`,
    `담당: ${i.assignees.length ? i.assignees.map(sanitizeInline).join(', ') : '(없음)'}`,
    `에픽: ${i.epic ? sanitizeInline(i.epic) : '(없음)'}`,
    `기한: ${i.dueDate ?? '(없음)'}`,
    `이유: ${REASON_LABEL[i.reason]}`,
    ...extras,
  ]
  if (i.lastComment) parts.push(`마지막 댓글: <issue>${sanitizeInline(i.lastComment)}</issue>`)
  return parts.join(' | ')
}

// 출력 정리 — 전체를 감싼 코드 펜스만 벗기고 trim. 비면 `${errorPrefix}_empty` 예외.
// max 자(코드 포인트)를 넘으면 자르지 않고 `${errorPrefix}_too_long` 예외 — 잘린 리포트(표·문장 중간에서 끊김)가 완성본으로 저장되지 않게,
// 실패로 돌려 API 가 다시 시도하게 한다. 길이는 서로게이트 쌍을 한 글자로 세려고 Array.from 으로 센다.
export function cleanOutput(text: string, errorPrefix: string, max: number): string {
  let t = text.trim()
  const fence = /^```[a-zA-Z]*[ \t]*\n([\s\S]*?)\n?```$/.exec(t)
  if (fence) t = fence[1].trim()
  if (!t) throw new Error(`${errorPrefix}_empty`)
  if (Array.from(t).length > max) throw new Error(`${errorPrefix}_too_long`)
  return t
}
