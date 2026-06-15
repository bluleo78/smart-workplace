// 위키 REST API client. 모든 함수는 AxiosResponse 반환 — 호출처에서 .data unwrap.

import type {
  SavePageRequest,
  WikiBacklinksResponse,
  WikiMember,
  WikiMentionRef,
  WikiPageDetail,
  WikiPageSummary,
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
  savePage: (pageId: number, req: SavePageRequest) =>
    client.put<WikiPageDetail>(`/wiki/pages/${pageId}`, req),
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
}
