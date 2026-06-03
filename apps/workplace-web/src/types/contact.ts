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
  editable: boolean
  createdAt: string
  updatedAt: string
}

// 외부 연락처 생성/수정 요청 바디 (백엔드 ExternalContactRequest 와 1:1).
export interface ExternalContactRequest {
  name: string
  email: string
  phone: string
  organization: string
  title: string
  notes: string
  visibility: ContactVisibility
}
