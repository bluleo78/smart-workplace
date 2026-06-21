// 드라이브 백엔드 DTO 와 1:1 매칭되는 TS 인터페이스.

// #76: CHANNEL = 메시징 채널에 연동된 공간.
export type DriveSpaceType = 'PERSONAL' | 'TEAM' | 'CHANNEL'
export type DriveRole = 'OWNER' | 'EDITOR' | 'VIEWER'

// #78: 공유 링크 가시성 — 외부(익명) / 사내(로그인).
export type ShareLinkAudience = 'EXTERNAL' | 'INTERNAL'

// #78: 공유 링크 생성 응답 — 평문 토큰은 이 응답에서만 1회 노출.
export interface CreatedShareLink {
  id: number
  token: string
  audience: ShareLinkAudience
  hasPassword: boolean
  expiresAt: string | null
}

// #78: 공유 링크 목록 항목 — 토큰 미포함.
export interface ShareLink {
  id: number
  audience: ShareLinkAudience
  hasPassword: boolean
  expiresAt: string | null
  revoked: boolean
  createdAt: string
  createdBy: number
}

export interface DriveSpace {
  id: number
  type: DriveSpaceType
  name: string
  ownerId: number
  role: DriveRole
  // #76: 보관된 채널에 연동된 공간은 archived=true → 읽기 전용 처리.
  archived: boolean
  createdAt: string
}

export interface DriveMember {
  userId: number
  name: string
  role: DriveRole
}

export interface DriveFolder {
  id: number
  parentId: number | null
  name: string
  createdAt: string
}

/** breadcrumb 세그먼트 — 백엔드 DriveFolderPathSegment 와 1:1. 루트→대상 순. */
export interface DriveFolderPathSegment {
  id: number
  name: string
}

export interface DriveFile {
  id: number
  folderId: number | null
  fileId: number
  name: string
  mimeType: string
  sizeBytes: number
  category: string
  createdAt: string
}

export interface DriveItemList {
  folders: DriveFolder[]
  files: DriveFile[]
}

/** 검색 결과 파일/폴더 — 백엔드 DriveFileHit/DriveFolderHit 와 1:1. folderPath = 조상 폴더 경로. */
export interface DriveFileHit extends DriveFile {
  folderPath: string
}

export interface DriveFolderHit extends DriveFolder {
  folderPath: string
}

export interface DriveSearchResult {
  folders: DriveFolderHit[]
  files: DriveFileHit[]
}

/** 휴지통 항목 — 백엔드 DriveTrashItemResponse 와 1:1. type: 'FOLDER'|'FILE'. */
export interface DriveTrashItem {
  type: 'FOLDER' | 'FILE'
  id: number
  name: string
  originalPath: string
  trashedAt: string
  autoPurgeAt: string
  sizeBytes: number | null
}

export interface DriveTrashList {
  items: DriveTrashItem[]
}
