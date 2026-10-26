// 노트 화면 테스트 공용 MSW 응답(WP-983) — 에디터를 띄우는 화면 테스트(wikiPage·wikiShare·wikiMobile)가 함께 쓴다.
import { http, HttpResponse, ws } from 'msw'

import { server } from '@/test/msw/server'

import { createTokenResponse } from '../../../e2e/factories/auth.factory'

/**
 * 에디터가 붙는 동기화 서버(/collab WebSocket)를 받기만 하고 아무것도 보내지 않는다 — 본문 동기화는 E2E(@platform) 몫이고,
 * 여기선 헤더·메뉴·카드처럼 동기화와 무관한 판정만 본다. 연결 시도가 「핸들러 없는 요청」으로 실패하지 않게 한다.
 */
const silentCollab = ws.link(/\/collab/).addEventListener('connection', () => {})

/** silentCollab 을 이 테스트에 건다 — renderScreen·renderPage 의 handlers 는 HTTP 핸들러 타입만 받으므로 서버에 직접 붙인다(테스트 사이 setup.ts 가 걷는다). */
export function attachSilentCollab() {
  server.use(silentCollab)
}

/**
 * 에디터 화면이 부르는 부가 조회 빈 응답 — 백링크·멘션, 이슈 만들기 대화상자의 프로젝트 목록,
 * 동기화 세션이 접속 토큰을 얻으려 부르는 refresh(renderScreen 은 메모리 토큰이 없다).
 */
export const editorSideHandlers = [
  http.get('/api/v1/projects', () => HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 })),
  http.post('/api/v1/auth/refresh', () => HttpResponse.json(createTokenResponse())),
  http.get('/api/v1/wiki/pages/:id/backlinks', () => HttpResponse.json({ items: [] })),
  http.get('/api/v1/wiki/pages/:id/mentions', () => HttpResponse.json([])),
]
