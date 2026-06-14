// 위키 REST API client. 모든 함수는 AxiosResponse 반환 — 호출처에서 .data unwrap.

import type {
  SavePageRequest,
  WikiMember,
  WikiPageDetail,
  WikiPageSummary,
  WikiSpace,
} from '../types/wiki'
import { client } from './client'

export const wikiApi = {
  listSpaces: () => client.get<WikiSpace[]>('/wiki/spaces'),
  createSpace: (name: string) => client.post<WikiSpace>('/wiki/spaces', { name }),
  getSpace: (spaceId: number) => client.get<WikiSpace>(`/wiki/spaces/${spaceId}`),
  listMembers: (spaceId: number) => client.get<WikiMember[]>(`/wiki/spaces/${spaceId}/members`),

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
}
