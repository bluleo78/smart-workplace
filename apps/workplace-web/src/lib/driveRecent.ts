// 드라이브 「최근」(WP-1699) 순수 함수 — 날짜 묶음·마지막 활동 문구·경로 줄. 날짜 기준은 모두 KST.

import type { DriveFileAction, DriveRecentFile } from '@/types/drive'

import { formatDateOnlyMonthDay, formatFileSize, formatRelativeTime, kstDateKey, kstParts, pad2, parseUtcDate } from './formatters'

/** 날짜 묶음 — 위에서 아래로 최근 → 오래된 순. */
export type RecentBucket = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'earlier'

/** 묶음 순서(머리글을 이 순서로 그린다). */
export const RECENT_BUCKET_ORDER: readonly RecentBucket[] = ['today', 'yesterday', 'thisWeek', 'thisMonth', 'earlier']

export const RECENT_BUCKET_LABEL: Record<RecentBucket, string> = {
  today: '오늘',
  yesterday: '어제',
  thisWeek: '이번 주',
  thisMonth: '이번 달',
  earlier: '이전',
}

/** 마지막 행동 → 문구 동사. */
const ACTION_VERB: Record<DriveFileAction, string> = {
  OPEN: '내가 열었음',
  UPLOAD: '내가 올림',
  NEW_VERSION: '내가 새 판',
}

/** KST 날짜 키(YYYY-MM-DD) → 일 번호(1970-01-01 = 0) — 날짜끼리 빼기·요일 계산용(시간대 변환 없음). */
function dayNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

/**
 * 시각이 어느 묶음인지 — KST 날짜로 판정한다. 이번 주는 월요일 시작(오늘·어제 제외), 이번 달은 같은 KST 달(이번 주 제외).
 * 미래 시각(시계 어긋남)은 오늘로 본다.
 */
export function recentBucket(lastAt: string, now: Date): RecentBucket {
  const atKey = kstDateKey(parseUtcDate(lastAt))
  const nowKey = kstDateKey(now)
  const at = dayNumber(atKey)
  const today = dayNumber(nowKey)
  if (at >= today) return 'today'
  if (at === today - 1) return 'yesterday'
  // 1970-01-01 은 목요일(getUTCDay 4) → (일 번호 + 3) % 7 이 월요일 0 기준 요일.
  const mondayOffset = (today + 3) % 7
  if (at >= today - mondayOffset) return 'thisWeek'
  if (atKey.slice(0, 7) === nowKey.slice(0, 7)) return 'thisMonth'
  return 'earlier'
}

/** 입력 순서를 지키며 묶음별로 나눈다 — 묶음은 오늘 → 이전 순, 줄이 없는 묶음은 만들지 않는다. */
export function groupRecent(items: DriveRecentFile[], now: Date): { bucket: RecentBucket; items: DriveRecentFile[] }[] {
  const by = new Map<RecentBucket, DriveRecentFile[]>()
  for (const item of items) {
    const b = recentBucket(item.lastAt, now)
    const list = by.get(b)
    if (list) list.push(item)
    else by.set(b, [item])
  }
  return RECENT_BUCKET_ORDER.filter((b) => by.has(b)).map((bucket) => ({ bucket, items: by.get(bucket)! }))
}

/**
 * 마지막 활동 문구 — 오늘은 상대 시간(「방금 내가 열었음」·「10분 전 내가 올림」), 어제는 「어제 11:05 내가 새 판」,
 * 그 앞은 날짜만(「11월 16일 내가 열었음」, 다른 해는 연도까지).
 */
export function recentActivityLabel(item: Pick<DriveRecentFile, 'lastAction' | 'lastAt'>, now: Date): string {
  const verb = ACTION_VERB[item.lastAction]
  const bucket = recentBucket(item.lastAt, now)
  if (bucket === 'today') {
    // formatRelativeTime 의 「방금 전」은 동사와 이어 읽기 어색해 「방금」으로 줄인다.
    const rel = formatRelativeTime(item.lastAt, now)
    return `${rel === '방금 전' ? '방금' : rel} ${verb}`
  }
  const t = kstParts(parseUtcDate(item.lastAt))
  if (bucket === 'yesterday') return `어제 ${pad2(t.h)}:${pad2(t.min)} ${verb}`
  return `${formatDateOnlyMonthDay(kstDateKey(parseUtcDate(item.lastAt)), now)} ${verb}`
}

/** 이름 아래 줄 — 「공간 › 폴더 › 하위폴더 · 1.2 MB」. */
export function recentPathLine(item: Pick<DriveRecentFile, 'spaceName' | 'folderPath' | 'sizeBytes'>): string {
  const path = [item.spaceName, ...item.folderPath.map((c) => c.name)].join(' › ')
  return `${path} · ${formatFileSize(item.sizeBytes)}`
}
