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
  // #736: AI 생성 attribution — 값 존재 여부만으로 사이드바 트리 배지를 판단(null 이면 AI 이력 없음).
  aiLastUsedAt: string | null
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
  // #736: 페이지 단위 AI 생성 attribution(마지막 사용 시각/액션). 둘 다 null 이면 AI 이력 없음.
  aiLastUsedAt: string | null
  aiLastAction: string | null
}

// 멘션 참조 종류 — 본문 토큰(<@id>·<#page:id>·<#issue:id>) 의 대상 타입.
// 값은 공용 스키마 패키지가 원본(동기화 서버와 공유) — 웹은 재수출해 기존 import 경로를 유지한다.
import type { WikiMentionType } from '@smart-workplace/wiki-editor-schema'
export type { WikiMentionType }

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

// #751: 노트 본문 이미지 첨부 업로드 응답. url 은 그대로 마크다운에 삽입한다(클라이언트가 경로를 조립하지 않는다).
export type WikiAttachment = {
  fileId: number
  url: string
  originalName: string
  mimeType: string
  sizeBytes: number
}

/** WP-301 노트 상단 AI 요약 상태(백엔드 WikiSummaryStatus). */
export type WikiSummaryStatus = 'READY' | 'STALE' | 'MISSING' | 'TOO_SHORT' | 'UNAVAILABLE'

/** WP-301 노트 요약 응답 — summaryVersion 은 요약 당시 노트 버전, pageVersion 은 응답 시점 버전. */
export interface WikiPageSummaryState {
  summary: string | null
  status: WikiSummaryStatus
  summaryVersion: number | null
  pageVersion: number
  summarizedAt: string | null
}

/** WP-282 버전 기록 — 스냅샷을 남긴 까닭(백엔드 RevisionReason). 옛 행은 null. */
export type WikiRevisionReason = 'SESSION' | 'PERIODIC' | 'AI' | 'RESTORE'

/** 버전 기록에 보이는 사람 — 편집자·AI 요청자(백엔드 WikiRevisionItem.Person). */
export interface WikiRevisionPerson {
  id: number
  name: string
}

/** 버전 기록 목록의 한 판(백엔드 WikiRevisionItem). aiActor 는 AI 적용 직전 스냅샷일 때만 요청자. */
export interface WikiRevisionItem {
  version: number
  title: string
  editedAt: string
  createdAt: string
  reason: WikiRevisionReason | null
  editors: WikiRevisionPerson[]
  aiActor: WikiRevisionPerson | null
}

/** 버전 기록 목록 응답(백엔드 WikiRevisionListResponse) — current 는 지금 판, items 는 최신순(최대 200). */
export interface WikiRevisionList {
  current: { version: number; editedAt: string; editors: WikiRevisionPerson[] }
  items: WikiRevisionItem[]
}

/** 한 판 본문(백엔드 WikiRevisionDetail) — body 는 마크다운. */
export interface WikiRevisionDetail extends WikiRevisionItem {
  body: string
}
