// 통합 검색(WP-1353)의 최근 검색어 — 이 브라우저에만 최대 5개. 저장소가 막혀도 탭 안에서는 기억한다(storageWithFallback).
import { readStored, writeStored } from '@/lib/storageWithFallback'

const KEY = 'wp.globalSearch.recent'
const MAX_RECENT = 5

/** 저장된 최근 검색어(최신 먼저). 깨진 값이면 빈 목록. */
export function loadRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(readStored(KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

/** 검색어를 맨 앞에 넣는다 — 같은 검색어는 하나로, 5개를 넘으면 오래된 것부터 버린다. 빈 검색어는 무시. 저장 뒤 목록을 돌려준다. */
export function pushRecent(q: string): string[] {
  const term = q.trim()
  if (!term) return loadRecent()
  const next = [term, ...loadRecent().filter((v) => v !== term)].slice(0, MAX_RECENT)
  writeStored(KEY, JSON.stringify(next))
  return next
}

/** 최근 검색어를 모두 지운다. */
export function clearRecent(): void {
  writeStored(KEY, null)
}
