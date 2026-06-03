// 연락처 백엔드 DTO 와 1:1 매칭되는 TS 타입.

export type ContactType = 'MEMBER' | 'EXTERNAL'
export type ContactTypeFilter = 'ALL' | 'MEMBER' | 'EXTERNAL'
export type ContactVisibility = 'SHARED' | 'PERSONAL'

export interface ContactSummary {
  type: ContactType
  id: number
  name: string
  email: string | null
  title: string | null
  organization: string | null
}

export interface ContactPage {
  items: ContactSummary[]
  nextCursor: string | null
  hasMore: boolean
}

export interface MemberDetail {
  id: number
  username: string
  name: string
  email: string | null
  title: string | null
  kind: string
  groups: string[]
}

export interface ExternalContactDetail {
  id: number
  name: string
  email: string | null
  phone: string | null
  organization: string | null
  title: string | null
  notes: string | null
  visibility: ContactVisibility
  createdAt: string
  updatedAt: string
}
