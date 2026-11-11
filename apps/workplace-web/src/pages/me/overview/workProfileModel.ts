// 업무 프로파일 카드(WP-1485) 화면 판정 — 상태줄 문구(「이번 달 37건 분석 · 오늘 08:00」)와 기간 라벨. 렌더와 분리해 순수 함수 테스트로 고정한다.
// 날짜 경계는 브라우저 시간대가 아니라 서울 시각으로 가른다(서버 매일 08:00 갱신·기간 계산이 서울 기준).
import { kstDayRelative, kstParts, parseUtcDate } from '@/lib/formatters'
import type { MeOverviewPeriod, WorkProfile } from '@/types/meOverview'

import { PERIOD_OPTIONS } from './overviewModel'

/** 한 번에 분석하는 끝낸 이슈 상한 — 서버와 같은 값. 넘으면 최근 것부터 이만큼만 읽는다. */
export const WORK_PROFILE_CAP = 100

/** 기간 → 「이번 주」/「이번 달」/「최근 3개월」 — 탭 줄 기간 고르기와 같은 문구. */
export function periodLabel(period: MeOverviewPeriod): string {
  return PERIOD_OPTIONS.find((o) => o.value === period)?.label ?? ''
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * 머리 오른쪽 상태줄 — 「이번 달 37건 분석 · 오늘 08:00」, 다른 날이면 「11월 10일 08:00」.
 * 상한에 걸려 일부만 읽었으면 「이번 주 140건 중 최근 100건 분석 · …」로 밝힌다.
 * 분석 결과가 있는 READY·FAILED(이전 결과)이고 분석 시각이 있을 때만 — 그 밖(NONE·PENDING)은 null(카드가 따로 그린다).
 */
export function statusLine(p: WorkProfile, now: Date): string | null {
  if ((p.status !== 'READY' && p.status !== 'FAILED') || !p.analyzedAt) return null
  const at = parseUtcDate(p.analyzedAt)
  if (Number.isNaN(at.getTime())) return null
  const t = kstParts(at)
  const day = kstDayRelative(t, now) === 'today' ? '오늘' : `${t.m}월 ${t.d}일`
  // 상한에 걸린 경우만 「n건 중 최근 100건」 — 분석 뒤 지워진 이슈로 total 이 analyzed 보다 큰 경우는 상한이 아니다.
  const capped = p.analyzedCount >= WORK_PROFILE_CAP && p.totalCount > p.analyzedCount
  const count = capped ? `${p.totalCount}건 중 최근 ${p.analyzedCount}건` : `${p.totalCount}건`
  return `${periodLabel(p.period)} ${count} 분석 · ${day} ${pad(t.h)}:${pad(t.min)}`
}
