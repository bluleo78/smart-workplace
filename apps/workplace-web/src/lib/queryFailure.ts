// 조회 실패 표시 판정(WP-881) — 실패 안내(LoadErrorState·WidgetError)를 다시 부르는 동안에도 그대로 두기 위한 공용 기준.
// TanStack Query 는 데이터 없이 실패한 쿼리를 다시 부르면 status 를 'pending' 으로 돌린다 — 그래서 isLoadingError·isError 로
// 안내를 그리면 다시 시도를 누르는 순간 안내가 사라졌다가(「불러오는 중…」·빈 상태) 다시 실패하면 새로 그려져,
// 키보드 초점이 body 로 사라졌다. 실패 횟수(errorUpdateCount)는 다시 부르는 중에도 남으므로 그것으로 판정한다.

import { useState } from 'react'

import { isNotFoundError } from '@/lib/api-error'

/** 판정에 쓰는 쿼리 상태 — useQuery·useInfiniteQuery 결과 그대로 넘긴다. */
type QueryFailureState = { data?: unknown; errorUpdateCount: number; isPlaceholderData?: boolean }

/**
 * 첫 조회가 실패해 아직 (이 키의) 데이터가 없다 — 다시 부르는 중(pending)에도 참. isLoadingError 대신 쓴다.
 * placeholderData(이전 키 데이터 유지)가 있으면 data 가 차 있어도 이 키의 데이터가 아니므로 없는 것으로 본다.
 */
export function failedWithoutData(q: QueryFailureState): boolean {
  return (q.data === undefined || q.isPlaceholderData === true) && q.errorUpdateCount > 0
}

/** 실패 안내를 그릴지 — 지금 실패 상태(isError, 데이터가 남은 재조회 실패 포함)이거나 첫 실패 뒤 다시 부르는 중. isError 대신 쓴다. */
export function showsLoadError(q: QueryFailureState & { isError: boolean }): boolean {
  return q.isError || failedWithoutData(q)
}

/**
 * 데이터 없이 404(삭제·볼 수 없음)로 실패했는지 — 다시 부르는 중(pending)에도 참(WP-1937).
 * 다시 부르면 TanStack Query 가 error 를 비우므로 isError·error 만으로는 그 사이 404 안내가 일반 오류 안내로 번쩍 바뀐다.
 * 마지막 실패가 404 였는지를 key(보고 있는 대상 id 등)와 함께 기억해, failedWithoutData 인 동안 그 판정을 잇는다.
 */
export function useNotFoundWithoutData(
  q: QueryFailureState & { isError: boolean; error: unknown },
  key: unknown,
): boolean {
  const [last, setLast] = useState<{ key: unknown; notFound: boolean } | null>(null)
  // 렌더 중 보정 — 지금 실패면 그 종류를 기억한다(같으면 다시 쓰지 않아 렌더가 되풀이되지 않는다).
  const nowNotFound = q.isError && isNotFoundError(q.error)
  if (q.isError && (last?.key !== key || last?.notFound !== nowNotFound)) setLast({ key, notFound: nowNotFound })
  if (q.isError) return nowNotFound
  return failedWithoutData(q) && last?.key === key && last?.notFound === true
}
