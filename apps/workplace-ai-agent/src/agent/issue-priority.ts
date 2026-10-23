// 이슈 우선순위 정규화(WP-886) — 모델이 낸 값을 5단계(공용 목록) 중 하나로 맞춘다.
// 분류(run-issue-classify-ai)와 메일 초안(mail-parser)이 같은 규칙을 쓰도록 한 곳에 둔다.
import { ISSUE_PRIORITIES } from '@smart-workplace/mcp-tools-shared'

export type IssuePriority = (typeof ISSUE_PRIORITIES)[number]

/**
 * 앞뒤 공백을 걷고 대문자로 바꾼 값이 5단계(HIGHEST·HIGH·MID·LOW·LOWEST)에 있으면 그대로, 그 밖(모르는 값·문자열 아님·누락)은 MID.
 * 모델이 " highest " 처럼 공백·소문자로 적어도 살리고, 서버 @Pattern 에 걸려 400 이 나지 않게 한다.
 */
export function normalizePriority(value: unknown): IssuePriority {
  if (typeof value !== 'string') return 'MID'
  const v = value.trim().toUpperCase()
  return (ISSUE_PRIORITIES as readonly string[]).includes(v) ? (v as IssuePriority) : 'MID'
}
