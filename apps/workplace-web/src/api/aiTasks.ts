// AI 위임 작업 조회(WP-377) — /me/ai-tasks. scope·agentState·status·priority 필터를 쿼리스트링으로 전달.
import type { IssueSearchResponse } from '../types/issue'
import { client } from './client'

/** 상태별 건수 — 칩 배지용. all 은 미완료(진행 중 작업이 있는 이슈) — 옛 「전체」 칩 필드명을 서버가 호환으로 유지한다. */
export interface AiTaskCounts {
  all: number
  inputRequired: number
  review: number
  // 막힘 + 인증 필요 합.
  blocked: number
  working: number
  // 완료 — 진행 중 작업 없이 종료 작업만 있는 이슈(WP-396).
  done: number
}

export async function fetchAiTasks(
  params: Record<string, string>,
  cursor: string | null,
  size = 30,
): Promise<IssueSearchResponse> {
  const sp = new URLSearchParams(params)
  if (cursor) sp.set('cursor', cursor)
  sp.set('size', String(size))
  const { data } = await client.get<IssueSearchResponse>(`/me/ai-tasks?${sp.toString()}`)
  return data
}

export async function fetchAiTaskCounts(params: Record<string, string>): Promise<AiTaskCounts> {
  const { data } = await client.get<AiTaskCounts>(`/me/ai-tasks/counts?${new URLSearchParams(params).toString()}`)
  return data
}
