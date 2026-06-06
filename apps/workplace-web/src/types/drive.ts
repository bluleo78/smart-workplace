// 드라이브 백엔드 DTO 와 1:1 매칭되는 TS 인터페이스.

export type DriveSpaceType = 'PERSONAL' | 'TEAM'
export type DriveRole = 'OWNER' | 'EDITOR' | 'VIEWER'

export interface DriveSpace {
  id: number
  type: DriveSpaceType
  name: string
  ownerId: number
  role: DriveRole
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
