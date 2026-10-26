// 연락처 딥링크 페이지 테스트(backContacts·backContactsDesktop) 공용 MSW 응답 — e2e/pages/mobile/back-contacts.spec.ts 의 stubContacts 와 같다.
import { http, HttpResponse } from 'msw'

import { external, externalDetail, member, memberDetail, page as makePage } from '../../../../e2e/factories/contacts.factory'

/** 긴 조직명 — 상세·목록 행의 실데이터 폭. */
const LONG_ORG = '글로벌 클라우드 인프라 운영 및 보안 컨설팅 그룹 아시아태평양 지역 본부'

/** 목록(구성원 1·외부 100), 두 상세, 없는 구성원(999 → 404). */
export function contactHandlers() {
  return [
    http.get('/api/v1/contacts', () => HttpResponse.json(makePage([member(), external({ organization: LONG_ORG })]))),
    http.get('/api/v1/contacts/members/1', () => HttpResponse.json(memberDetail())),
    http.get('/api/v1/contacts/external/100', () => HttpResponse.json(externalDetail({ organization: LONG_ORG }))),
    // 필터 옵션(조직·직함) — 데스크톱 필터 줄이 부른다.
    http.get('/api/v1/contacts/facets', () => HttpResponse.json({ organizations: [], titles: [] })),
    http.get('/api/v1/contacts/members/999', () => HttpResponse.json({ message: 'not found' }, { status: 404 })),
  ]
}
