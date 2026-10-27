// 위키 REST API client. 모든 함수는 AxiosResponse 반환 — 호출처에서 .data unwrap.

import { WIKI_SHARE_TOKEN_HEADER } from '@smart-workplace/wiki-editor-schema/collab-protocol'

import type {
  WikiAttachment,
  WikiBacklinksResponse,
  WikiMember,
  WikiMentionRef,
  WikiMovePreview,
  WikiPageDetail,
  WikiPageEntry,
  WikiPageShare,
  WikiPageShareRequest,
  WikiPageShareState,
  WikiPageSummary,
  WikiPageSummaryState,
  WikiRevisionDetail,
  WikiRevisionList,
  WikiSearchResult,
  WikiShareAccessRequestResult,
  WikiSharedPageItem,
  WikiShareEvent,
  WikiShareListItem,
  WikiShareResolved,
  WikiSpace,
} from '../types/wiki'
import { client } from './client'

/**
 * 공유 토큰 → 요청 헤더(WP-579, 헤더 이름은 동기화 서버와 같은 collab-protocol 상수) — 서버는 멤버가 아닐 때 이 토큰으로 접근을 판정한다.
 * 헤더를 만드는 곳은 여기 한 곳이다(이미지 blob 처럼 이 파일 밖에서 부르는 요청도 이걸 쓴다).
 */
export const shareHeaders = (token?: string) => (token ? { [WIKI_SHARE_TOKEN_HEADER]: token } : undefined)

export const wikiApi = {
  listSpaces: () => client.get<WikiSpace[]>('/wiki/spaces'),
  createSpace: (name: string) => client.post<WikiSpace>('/wiki/spaces', { name }),
  getSpace: (spaceId: number) => client.get<WikiSpace>(`/wiki/spaces/${spaceId}`),
  // 팀 스페이스 영구 삭제(WP-580) — OWNER 만, 개인 스페이스는 서버가 거부한다.
  deleteSpace: (spaceId: number) => client.delete<void>(`/wiki/spaces/${spaceId}`),
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

  // base=false: 새 웹은 본문을 동기화 서버로 저장하므로 AI 병합 기준본을 남길 필요가 없다(WP-289 — 기본값은 구버전 웹·MCP 용 기록).
  // shareToken: 공유 링크로 연 화면(WP-579) — 스페이스 멤버가 아니어도 이 토큰으로 읽는다.
  getPage: (pageId: number, shareToken?: string) =>
    client.get<WikiPageDetail>(`/wiki/pages/${pageId}`, { params: { base: false }, headers: shareHeaders(shareToken) }),
  // 제목만 저장 — 본문은 동기화 서버(Yjs)가 원본이라 웹은 본문을 REST 로 보내지 않는다(WP-287). body:null 은 서버 계약상 "본문 유지".
  // 공유 화면(편집 링크)은 제목만 고칠 수 있다 — 서버는 body 가 없을 때만 공유 토큰을 받는다.
  savePageTitle: (pageId: number, title: string, shareToken?: string) =>
    client.put<WikiPageDetail>(`/wiki/pages/${pageId}`, { title, body: null }, { headers: shareHeaders(shareToken) }),
  // 「전체 폭」만 저장(WP-793) — title·body:null 은 서버 계약상 "유지". 공유 화면(편집 링크)도 제목처럼 바꿀 수 있다.
  savePageFullWidth: (pageId: number, fullWidth: boolean, shareToken?: string) =>
    client.put<WikiPageDetail>(`/wiki/pages/${pageId}`, { title: null, body: null, fullWidth }, { headers: shareHeaders(shareToken) }),
  // targetSpaceId: 다른 스페이스로 옮길 때만(WP-988) — 없으면 같은 스페이스 안 이동이다.
  movePage: (pageId: number, parentId: number | null, position: number, targetSpaceId?: number) =>
    client.patch<void>(`/wiki/pages/${pageId}/move`, { parentId, position, targetSpaceId }),
  // 다른 스페이스로 옮기기 전 영향 미리보기(WP-988).
  getMovePreview: (pageId: number, targetSpaceId: number) =>
    client.get<WikiMovePreview>(`/wiki/pages/${pageId}/move-preview`, { params: { targetSpaceId } }),
  deletePage: (pageId: number) => client.delete<void>(`/wiki/pages/${pageId}`),

  // 본문 멘션 토큰을 라벨/링크 정보로 해소 — 칩 렌더용. 공유 화면이면 볼 수 없는 대상은 inaccessible 로 온다.
  getMentions: (pageId: number, shareToken?: string) =>
    client.get<WikiMentionRef[]>(`/wiki/pages/${pageId}/mentions`, { headers: shareHeaders(shareToken) }),
  // 알림에서 노트를 열 때 갈 곳(WP-579) — 멤버면 노트 주소, 공유 대상이면 지금 토큰. 둘 다 아니면 404.
  // link: 노트 주소로 연 비멤버(WP-987) — 워크스페이스 전체 공유도 보고 토큰을 받는다. 알림은 지정한 사람 공유만(link 없음).
  getPageEntry: (pageId: number, link = false) =>
    client.get<WikiPageEntry>(`/wiki/pages/${pageId}/entry`, link ? { params: { link: true } } : undefined),
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

  // WP-282 버전 기록 — 목록(최신순)·한 판 본문·복원(본문만, 응답은 페이지 상세).
  listRevisions: (pageId: number) => client.get<WikiRevisionList>(`/wiki/pages/${pageId}/revisions`),
  getRevision: (pageId: number, version: number) =>
    client.get<WikiRevisionDetail>(`/wiki/pages/${pageId}/revisions/${version}`),
  restoreRevision: (pageId: number, version: number) =>
    client.post<WikiPageDetail>(`/wiki/pages/${pageId}/revisions/${version}/restore`),

  // #751: 본문 이미지 업로드. 응답 url 을 그대로 마크다운에 삽입한다(클라이언트가 경로를 조립하지 않는다).
  // shareToken: 공유 화면(편집 링크)에서 이미지를 붙여 넣을 때.
  uploadAttachment: (pageId: number, file: File, shareToken?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    return client.post<WikiAttachment>(`/wiki/pages/${pageId}/attachments`, fd, {
      headers: { 'Content-Type': 'multipart/form-data', ...shareHeaders(shareToken) },
    })
  },
  // 본문 이미지 첨부 삭제.
  deleteAttachment: (pageId: number, fileId: number) =>
    client.delete<void>(`/wiki/pages/${pageId}/attachments/${fileId}`),

  // WP-579 페이지 공유 — 공유 창 상태(설정·외부 허용·상위 공유·접근 요청)·만들기/바꾸기·재발급·해제·기록.
  getShare: (pageId: number) => client.get<WikiPageShareState>(`/wiki/pages/${pageId}/share`),
  saveShare: (pageId: number, req: WikiPageShareRequest) =>
    client.put<WikiPageShare>(`/wiki/pages/${pageId}/share`, req),
  regenerateShare: (pageId: number) => client.post<WikiPageShare>(`/wiki/pages/${pageId}/share/regenerate`),
  deleteShare: (pageId: number) => client.delete<void>(`/wiki/pages/${pageId}/share`),
  // 「이 페이지와 하위는 상위 공유에서 제외」 켜기·풀기(WP-987) — 상위 공유 창의 「제외 풀기」도 하위 페이지 id 로 부른다.
  excludeFromParentShare: (pageId: number) => client.put<void>(`/wiki/pages/${pageId}/share/exclusion`),
  includeInParentShare: (pageId: number) => client.delete<void>(`/wiki/pages/${pageId}/share/exclusion`),
  listShareEvents: (pageId: number) => client.get<WikiShareEvent[]>(`/wiki/pages/${pageId}/share/events`),
  // 스페이스에서 공유 중인 페이지 목록.
  listSharedPages: (spaceId: number) => client.get<WikiSharedPageItem[]>(`/wiki/spaces/${spaceId}/shares`),
  // 공유 링크 열기 — 토큰으로 볼 수 있는 페이지 묶음을 받는다.
  resolveShare: (token: string) => client.get<WikiShareResolved>(`/wiki/shares/${token}`),
  // 지정한 사람이 아닌 멤버의 접근 요청과, 공유한 사람의 승인·거절.
  requestShareAccess: (token: string) =>
    client.post<WikiShareAccessRequestResult>(`/wiki/shares/${token}/access-requests`),
  decideShareAccess: (pageId: number, requestId: number, approve: boolean) =>
    client.post<void>(`/wiki/pages/${pageId}/share/access-requests/${requestId}/${approve ? 'approve' : 'deny'}`),

  // 관리자 — 외부 공유 허용 정책, 워크스페이스 전체 공유 목록·일괄 해제.
  getSharePolicy: () => client.get<{ externalShareEnabled: boolean }>('/admin/wiki/share-policy'),
  saveSharePolicy: (externalShareEnabled: boolean) =>
    client.put<{ externalShareEnabled: boolean }>('/admin/wiki/share-policy', { externalShareEnabled }),
  listAllShares: () => client.get<WikiShareListItem[]>('/admin/wiki/shares'),
  // 내가 만든 공유(모든 스페이스) — 설정 › 내 공유.
  listMyShares: () => client.get<WikiShareListItem[]>('/wiki/shares/mine'),
  revokeShares: (pageIds: number[]) => client.post<void>('/admin/wiki/shares/revoke', { pageIds }),
}
