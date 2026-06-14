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
