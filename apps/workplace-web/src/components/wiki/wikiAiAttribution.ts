// 노트 머리 「AI 작성」 표지(WP-1483) — 프로젝트 리포트처럼 AI 가 페이지 전체를 쓴 노트(aiLastAction='report')의 출처 문구.
// 그 밖의 AI 사용 페이지는 null 을 돌려 지금처럼 「AI 생성」 칩을 쓴다.
import { formatKstDayClock, parseUtcDate } from '@/lib/formatters'
import type { WikiPageDetail } from '@/types/wiki'

/** 시스템이 리포트를 쓸 때 남기는 AI 액션 이름(서버 WikiSystemPageWriter.AI_ACTION_REPORT). */
const REPORT_ACTION = 'report'

/**
 * 「AI 작성」 표지 문구.
 * - 리포트이고 수정 시각 ≤ AI 작성 시각 → 「AI 작성」 — 열기만 하고 고치지 않았으면 두 시각이 같다(같은 순간이면 표기 차이와 무관하게 같다고 본다).
 * - 수정 시각이 더 늦음 → 「AI 작성 · {이름} 수정 {시각}」, 이름을 모르면 「AI 작성 · 수정 {시각}」(시각은 오늘이면 「오늘 10:12」).
 * - 리포트가 아니면 null.
 */
export function aiAttributionLabel(
  page: Pick<WikiPageDetail, 'aiLastAction' | 'aiLastUsedAt' | 'updatedAt' | 'updatedByName'>,
  now: Date,
): string | null {
  if (page.aiLastAction !== REPORT_ACTION || !page.aiLastUsedAt) return null
  const aiAt = parseUtcDate(page.aiLastUsedAt).getTime()
  const editedAt = parseUtcDate(page.updatedAt).getTime()
  // 시각을 못 읽으면 고쳤다고 단정하지 않는다.
  if (Number.isNaN(aiAt) || Number.isNaN(editedAt) || editedAt <= aiAt) return 'AI 작성'
  const when = formatKstDayClock(page.updatedAt, now, '오늘')
  const edited = [page.updatedByName ? `${page.updatedByName} 수정` : '수정', when].filter(Boolean).join(' ')
  return `AI 작성 · ${edited}`
}

/**
 * 좁은 폭(모바일 노트 머리)용 짧은 표지 — 제목이 먼저 보이게 이름·시각을 빼고 「AI 작성」 / 「AI 작성 · 수정됨」만 남긴다.
 * 전체 문구는 호출부가 title·스크린리더 글로 함께 둔다.
 */
export function shortAiAttributionLabel(label: string): string {
  return label === 'AI 작성' ? label : 'AI 작성 · 수정됨'
}
