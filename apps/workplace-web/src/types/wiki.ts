// 위키 백엔드 DTO 미러.

export type WikiRole = 'OWNER' | 'EDITOR' | 'VIEWER'
export type WikiSpaceType = 'PERSONAL' | 'TEAM'

export interface WikiSpace {
  id: number
  type: WikiSpaceType
  name: string
  ownerId: number
  role: WikiRole
  createdAt: string
}

export interface WikiMember {
  userId: number
  name: string
  role: WikiRole
}

export interface WikiPageSummary {
  id: number
  parentId: number | null
  title: string
  position: number
}

export interface WikiPageDetail {
  id: number
  spaceId: number
  parentId: number | null
  title: string
  body: string
  version: number
  updatedBy: number | null
  updatedAt: string
}

export interface SavePageRequest {
  title: string
  body: string
  version: number
  snapshot: boolean
}

// 멘션 참조 종류 — 본문 토큰(<@id>·<#page:id>·<#issue:id>) 의 대상 타입.
export type WikiMentionType = 'USER' | 'PAGE' | 'ISSUE'

// 페이지 본문에 등장하는 멘션을 라벨/링크 정보로 해소한 참조(백엔드 1:1).
export interface WikiMentionRef {
  type: WikiMentionType
  id: number
  label: string
  spaceId: number | null
  projectKey: string | null
  number: number | null
}

// 백링크 — 이 페이지를 참조(멘션)하는 다른 위키 페이지(백엔드 1:1).
export interface WikiBacklink {
  pageId: number
  spaceId: number
  spaceName: string
  title: string
  updatedAt: string
}

export interface WikiBacklinksResponse {
  items: WikiBacklink[]
}

// 위키 검색 결과 한 건(S2, 백엔드 1:1). snippet 은 본문 앞부분 미리보기.
export interface WikiSearchResult {
  id: number
  spaceId: number
  spaceName: string
  title: string
  snippet: string
  updatedAt: string
}
