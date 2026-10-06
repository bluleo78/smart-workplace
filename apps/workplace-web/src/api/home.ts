import { downloadBlob } from '@/lib/download';
import { homeAttachmentContentPath } from '@/lib/homeChatAttachments';
import type {
  ActiveChats,
  ActivityPage,
  ChatRequest,
  HomeChatStarted,
  HomeMessage,
  HomeSessionPage,
  HomeUploadedFile,
  PendingAction,
  ProposalOutcome,
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

  /** #843: 세션의 미처리 확인카드(새로고침·세션 복원 시 재표시). */
  sessionProposals: (sessionId: string) =>
    client.get<PendingAction[]>(`/home/sessions/${sessionId}/proposals`),

  /** #843: 확인카드 승인 — 실행 실패도 200(proposal.status=FAILED + 사유). 이미 처리됨 409 · 없음 404. */
  confirmProposal: (id: number) => client.post<ProposalOutcome>(`/home/proposals/${id}/confirm`),

  /** #843: 확인카드 거부 — 서버에 REJECTED 로 기록(AI 가 같은 제안을 반복하지 않도록). */
  rejectProposal: (id: number) => client.post<ProposalOutcome>(`/home/proposals/${id}/reject`),

  /** AI 채팅 생성 시작(#593 편입) — correlationId 즉시 반환, 실제 델타는 /events 로 도착. */
  startChat: (body: ChatRequest) =>
    client.post<HomeChatStarted>('/ai/chat', body),

  /** 생성 중 대화 목록 + 상한(WP-190) — 앱 시작·SSE 재연결·409/429 직후 재동기화. */
  activeChats: () => client.get<ActiveChats>('/ai/chat/active'),

  /** 진행 중인 채팅 생성 취소. */
  cancelChat: (correlationId: string) =>
    client.delete<void>(`/ai/chat/${correlationId}`),

  /**
   * WP-234: 첨부 사전 업로드 — 세션이 아니라 호출자 단위다(새 대화 첫 메시지 전엔 세션이 없다).
   * multipart 필드명 `files`. 응답은 요청 순서대로 온다(이미지 미리보기 짝짓기에 쓴다).
   */
  uploadAttachments: (files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    return client.post<HomeUploadedFile[]>('/home/attachments', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  /** WP-234: 세션 첨부 원본 blob — Bearer 인증이라 img src 로 직접 걸 수 없어 objectURL 로 바꿔 쓴다. */
  fetchAttachmentBlob: (sessionId: string, fileId: number) =>
    client
      .get<Blob>(homeAttachmentContentPath(sessionId, fileId), { responseType: 'blob' })
      .then((r) => r.data),

  /** WP-234: 세션 첨부 다운로드(문서 카드 클릭). */
  downloadAttachment: async (sessionId: string, fileId: number, fileName: string) => {
    const blob = await homeApi.fetchAttachmentBlob(sessionId, fileId);
    downloadBlob(fileName, blob);
  },
};
