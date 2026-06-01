// 프로젝트 횡단 "내 이슈" 검색 — /me/issues. assignee/reporter 등 필터를 쿼리스트링으로 전달.
import { client } from './client'
import type { IssueSearchResponse } from '../types/issue'

export async function fetchMeIssues(
  params: Record<string, string>,
  cursor: string | null,
  size = 30,
): Promise<IssueSearchResponse> {
  const sp = new URLSearchParams(params)
  if (cursor) sp.set('cursor', cursor)
  sp.set('size', String(size))
  const { data } = await client.get<IssueSearchResponse>(`/me/issues?${sp.toString()}`)
  return data
}
