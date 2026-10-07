// 위키 REST API client. 모든 함수는 AxiosResponse 반환 — 호출처에서 .data unwrap.

import type {
  WikiAttachment,
  WikiBacklinksResponse,
  WikiMember,
  WikiMentionRef,
  WikiPageDetail,
  WikiPageSummary,
  WikiPageSummaryState,
  WikiSearchResult,
  WikiSpace,
} from '../types/wiki'
import { client } from './client'

export const wikiApi = {
  listSpaces: () => client.get<WikiSpace[]>('/wiki/spaces'),
  createSpace: (name: string) => client.post<WikiSpace>('/wiki/spaces', { name }),
  getSpace: (spaceId: number) => client.get<WikiSpace>(`/wiki/spaces/${spaceId}`),
  listMembers: (spaceId: number) => client.get<WikiMember[]>(`/wiki/spaces/${spaceId}/members`),
  // 멤버 추가 — TEAM 스페이스 공유. 기본 EDITOR 로 초대(호출처 지정).
  addMember: (spaceId: number, userId: number, role: string) =>
    client.post<void>(`/wiki/spaces/${spaceId}/members`, { userId, role }),
  // 멤버 역할 변경 — OWNER 만. 소유자 자신은 변경 대상 아님.
  updateMemberRole: (spaceId: number, userId: number, role: string) =>
    client.patch<void>(`/wiki/spaces/${spaceId}/members/${userId}`, { role }),
  // 멤버 제거 — OWNER 만. 소유자는 제거 불가.
  removeMember: (spaceId: number, userId: number) =>
    client.delete<void>(`/wiki/spaces/${spaceId}/members/${userId}`),

  listPages: (spaceId: number) =>
    client.get<WikiPageSummary[]>(`/wiki/spaces/${spaceId}/pages`),
  createPage: (spaceId: number, parentId: number | null, title: string) =>
    client.post<WikiPageDetail>(`/wiki/spaces/${spaceId}/pages`, { parentId, title }),

  getPage: (pageId: number) => client.get<WikiPageDetail>(`/wiki/pages/${pageId}`),
  // 제목만 저장 — 본문은 동기화 서버(Yjs)가 원본이라 웹은 본문을 REST 로 보내지 않는다(WP-287). body:null 은 서버 계약상 "본문 유지".
  savePageTitle: (pageId: number, title: string) =>
    client.put<WikiPageDetail>(`/wiki/pages/${pageId}`, { title, body: null }),
  movePage: (pageId: number, parentId: number | null, position: number) =>
    client.patch<void>(`/wiki/pages/${pageId}/move`, { parentId, position }),
  deletePage: (pageId: number) => client.delete<void>(`/wiki/pages/${pageId}`),

  // 본문 멘션 토큰을 라벨/링크 정보로 해소 — 칩 렌더용.
  getMentions: (pageId: number) =>
    client.get<WikiMentionRef[]>(`/wiki/pages/${pageId}/mentions`),
  // 이 페이지를 참조하는 다른 페이지 목록(백링크).
  getBacklinks: (pageId: number) =>
    client.get<WikiBacklinksResponse>(`/wiki/pages/${pageId}/backlinks`),

  // 제목·본문으로 위키 페이지 검색(S2). spaceId 지정 시 해당 스페이스 우선.
  search: (q: string, spaceId?: number) =>
    client.get<WikiSearchResult[]>('/wiki/search', {
      params: { q, ...(spaceId != null ? { spaceId } : {}) },
    }),

  // AI 생성 시작 — correlationId 반환, 실제 토큰은 /events(wiki.ai.*)로 전달(#593 편입).
  startAi: (pageId: number, req: { action: string; prompt?: string; selection?: string }) =>
    client.post<{ correlationId: string }>(`/wiki/pages/${pageId}/ai`, req),
  // 진행 중인 AI 생성 취소.
  cancelAi: (pageId: number, correlationId: string) =>
    client.delete<void>(`/wiki/pages/${pageId}/ai/${correlationId}`),

  // WP-301 노트 상단 AI 요약 — 조회(상태 계산)·생성(저장 후 상태 반환).
  getSummary: (pageId: number) => client.get<WikiPageSummaryState>(`/wiki/pages/${pageId}/summary`),
  generateSummary: (pageId: number) =>
    client.post<WikiPageSummaryState>(`/wiki/pages/${pageId}/summary`),

  // #751: 본문 이미지 업로드. 응답 url 을 그대로 마크다운에 삽입한다(클라이언트가 경로를 조립하지 않는다).
  uploadAttachment: (pageId: number, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return client.post<WikiAttachment>(`/wiki/pages/${pageId}/attachments`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  // 본문 이미지 첨부 삭제.
  deleteAttachment: (pageId: number, fileId: number) =>
    client.delete<void>(`/wiki/pages/${pageId}/attachments/${fileId}`),
}
