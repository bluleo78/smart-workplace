// 「공유받은 항목」(WP-1539) 화면의 순수 판정 — 화면과 떼어 vitest 로 지킨다.
import type { SharedWithMeItem } from '@/types/drive'

import { kstDayRelative, kstParts, parseUtcDate } from './formatters'

/**
 * 「마지막으로 연 날」 칸 — 오늘·어제는 그 말로, 그 밖은 「11월 12일」(올해가 아니면 「2025년 11월 12일」).
 * 오늘·어제 판정과 날짜를 모두 KST(Asia/Seoul) 하나로 본다 — 섞으면 자정 무렵 「어제」 다음 칸이 하루 어긋난다.
 * 시각까지는 보이지 않는다 — 다시 찾는 데는 날이면 충분하고 좁은 칸에 들어가야 해서. 무효 입력이면 빈 문자열.
 */
export function sharedOpenedLabel(at: string, now: Date = new Date()): string {
  const date = parseUtcDate(at)
  if (Number.isNaN(date.getTime())) return ''
  const t = kstParts(date)
  const rel = kstDayRelative(t, now)
  if (rel) return rel === 'today' ? '오늘' : '어제'
  const md = `${t.m}월 ${t.d}일`
  return t.y === kstParts(now).y ? md : `${t.y}년 ${md}`
}

/**
 * 열 수 없는 행의 이유 문구 — 서버가 링크 폐기·만료·휴지통으로 열 수 없다고 했을 때만 그 이유를 말하고,
 * 링크는 살아 있는데 토큰을 되살리지 못한 경우(키 교체 등)는 중립 문구로 둔다. 열 수 있으면 null.
 */
export function sharedClosedReason(item: SharedWithMeItem): string | null {
  if (!item.openable) return '링크가 폐기됐거나 만료됐습니다'
  if (item.token == null) return '링크를 열 수 없습니다'
  return null
}

/**
 * 지금 열 수 있는 행인가 — 서버가 링크(폐기·만료)와 파일(휴지통)로 판정한 openable 을 따르고, 열 토큰이 있어야 한다.
 * 토큰이 없으면(되살릴 수 없는 옛 링크) 열기·복사를 막는다. 열 수 있어도 실제 접근은 열 때 링크로 다시 판정한다.
 */
export function canOpenShared(item: SharedWithMeItem): boolean {
  return item.openable && item.token != null
}
