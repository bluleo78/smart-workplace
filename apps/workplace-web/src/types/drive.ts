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
