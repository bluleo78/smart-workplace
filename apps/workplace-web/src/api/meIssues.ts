// 프로젝트 횡단 "내 이슈" 검색 — /me/issues. assignee/reporter 등 필터를 쿼리스트링으로 전달.
import type { IssueSearchResponse } from '../types/issue'
import { client } from './client'

export async function fetchMeIssues(
  params: Record<string, string>,
  cursor: string | null,
  size = 30,
  // 버려진 요청 취소(TanStack Query signal) — 입력을 이어 쓰면 앞선 검색을 끊어 서버가 헛돌지 않게(WP-1324).
  signal?: AbortSignal,
): Promise<IssueSearchResponse> {
  const sp = new URLSearchParams(params)
  if (cursor) sp.set('cursor', cursor)
  sp.set('size', String(size))
  const { data } = await client.get<IssueSearchResponse>(`/me/issues?${sp.toString()}`, { signal })
  return data
}
