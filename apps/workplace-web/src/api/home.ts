import type {
  ActivityPage,
  ComposeRequest,
  ComposeResponse,
  HomeMessage,
  HomeSessionPage,
  PendingAction,
} from '@/types/home';
import type { IssueSearchResponse } from '@/types/issue';

import { client } from './client';

/** 위젯 params(자유 형태)를 axios 쿼리스트링용 string map 으로 정규화. 배열은 CSV, undefined/null 은 제거. */
export function toQueryParams(params: Record<string, unknown> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = Array.isArray(v) ? v.join(',') : String(v);
  }
  return out;
}

export const homeApi = {
  /** 챗 명령 → AI compose(단일 응답). sessionId null 이면 백엔드가 새 세션 생성. */
  compose: (body: ComposeRequest) => client.post<ComposeResponse>('/ai/compose', body),

  /** 프로젝트 횡단 내 이슈 검색 (issue_list/my_tasks 위젯). */
  myIssues: (params: Record<string, unknown>) =>
    client.get<IssueSearchResponse>('/me/issues', { params: toQueryParams(params) }),

  /** 워치 이슈(my_tasks 워치 카운트). */
  watchedIssues: (size = 50) =>
    client.get<IssueSearchResponse>('/me/watched-issues', { params: { size } }),

  /** 최근 활동(activity 위젯). actorKind=AGENT 면 AI 가 한 일만. */
  activity: (params: { actorKind?: string; size?: number } = {}) =>
    client.get<ActivityPage>('/me/activity', { params }),

  /** 세션 목록(스위처). */
  listSessions: (size = 30) =>
    client.get<HomeSessionPage>('/home/sessions', { params: { size } }),

  /** 세션 전체 메시지(복원용). */
  sessionMessages: (sessionId: string) =>
    client.get<HomeMessage[]>(`/home/sessions/${sessionId}/messages`),

  /** 세션 삭제. */
  deleteSession: (sessionId: string) =>
    client.delete<void>(`/home/sessions/${sessionId}`),

  /** #333 M2: 확인 카드 승인 → 서버 실행기. actionType+params 그대로 전송. */
  confirmAction: (action: PendingAction) =>
    client.post('/home/actions/confirm', { actionType: action.actionType, params: action.params }),
};
