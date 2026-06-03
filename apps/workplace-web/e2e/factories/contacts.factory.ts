// 연락처 E2E 팩토리 — 통합 목록/상세 응답 모킹용.
import type {
  ContactPage,
  ContactSummary,
  ExternalContactDetail,
  MemberDetail,
} from '../../src/types/contact'

export function member(over: Partial<ContactSummary> = {}): ContactSummary {
  return { type: 'MEMBER', id: 1, name: '김멤버', email: 'kim@example.com', title: '팀장', organization: null, ...over }
}

export function external(over: Partial<ContactSummary> = {}): ContactSummary {
  return { type: 'EXTERNAL', id: 100, name: '박외부', email: 'park@corp.com', title: null, organization: 'Corp', ...over }
}

export function page(items: ContactSummary[]): ContactPage {
  return { items, nextCursor: null, hasMore: false }
}

export function memberDetail(over: Partial<MemberDetail> = {}): MemberDetail {
  return { id: 1, username: 'kim', name: '김멤버', email: 'kim@example.com', title: '팀장', kind: 'HUMAN', groups: ['개발팀'], ...over }
}

export function externalDetail(over: Partial<ExternalContactDetail> = {}): ExternalContactDetail {
  return {
    id: 100,
    name: '박외부',
    email: 'park@corp.com',
    phone: null,
    organization: 'Corp',
    title: null,
    notes: null,
    visibility: 'PERSONAL',
    editable: true,
    createdAt: '2026-06-03T00:00:00Z',
    updatedAt: '2026-06-03T00:00:00Z',
    ...over,
  }
}
