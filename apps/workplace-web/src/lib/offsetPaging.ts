// offset(page 번호) 페이징 API 를 무한 스크롤(useInfiniteQuery)로 이어 붙일 때 쓰는 공통 규칙 (WP-182).
import type { PageResponse } from '../types/common'

/** 다음 페이지 번호 — 마지막 페이지면 undefined(hasNextPage=false). */
export function nextOffsetPage<T>(last: PageResponse<T>) {
  return last.page + 1 < last.totalPages ? last.page + 1 : undefined
}

/**
 * 페이지 합본을 id 기준 중복 제거해 평탄화한다.
 * offset 페이징은 페이지 사이에 새 행이 끼면(예: 최신순 감사 로그) 경계 행이 다음 페이지에 다시 오므로
 * 그대로 이어 붙이면 같은 행이 두 번 보이고 React key 가 충돌한다.
 */
export function flattenUniquePages<T>(pages: PageResponse<T>[] | undefined, idOf: (item: T) => unknown): T[] {
  const seen = new Set<unknown>()
  const out: T[] = []
  for (const p of pages ?? []) {
    for (const item of p.content) {
      const id = idOf(item)
      if (seen.has(id)) continue
      seen.add(id)
      out.push(item)
    }
  }
  return out
}
