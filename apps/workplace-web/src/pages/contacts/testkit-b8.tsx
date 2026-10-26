// 연락처 화면 테스트 공용 도우미(WP-966 웨이브 3, b8) — contactsPage·userGroups·groupTreeTouch 테스트가 함께 쓴다.
// 연락처는 좌측 사이드바(검색·타입 필터·그룹 트리)와 본문(목록·상세·그룹 뷰)이 URL 검색 파라미터로 이어지므로,
// App 전체(renderPage) 대신 모듈 레이아웃(ContactModuleLayout)과 ContactsPage 만 renderScreen 으로 띄운다.
import { http, HttpResponse, type RequestHandler } from 'msw'
import { Route, Routes } from 'react-router-dom'

import { ContactModuleLayout } from '@/components/contacts/ContactModuleLayout'
import type { AuthContextValue } from '@/hooks/auth-context-value'
import { renderScreen } from '@/test/renderScreen'

import { ContactsPage } from './ContactsPage'

/** 요청 본문·주소를 모으는 기록기 — 쓰기 요청 payload 와 목록 쿼리를 단언할 때 쓴다. */
export type Recorded = { url: URL; body: unknown }

/** 핸들러 응답 전에 요청을 기록한다(본문이 없거나 JSON 이 아니면 body=null). */
export async function record(list: Recorded[], request: Request) {
  const text = await request.clone().text()
  list.push({ url: new URL(request.url), body: text ? JSON.parse(text) : null })
}

/** 그룹 트리 GET — 사이드바가 늘 부른다. 그룹을 쓰지 않는 테스트도 비어 있지 않은 트리를 주면 화면이 실제와 같다. */
export const emptyTree = () => http.get('/api/v1/user-groups', () => HttpResponse.json({ shared: [], personal: [] }))

/**
 * /contacts 화면(사이드바 + 목록·상세)을 띄운다. 라우트 모양을 앱과 같게(레이아웃 → contacts) 둬 Outlet 이 본문을 그린다.
 * 첫 findBy* 는 기본 timeout 으로 충분하다 — 모듈을 정적으로 불러온다.
 */
export function renderContacts(
  path = '/contacts',
  { handlers = [], auth }: { handlers?: RequestHandler[]; auth?: Partial<AuthContextValue> } = {},
) {
  return renderScreen(
    <Routes>
      <Route element={<ContactModuleLayout />}>
        <Route path="/contacts" element={<ContactsPage />} />
      </Route>
    </Routes>,
    { path, handlers, auth },
  )
}

/** 관리자 — GroupTree·GroupContactView 는 AuthContext.isAdmin 으로 조직도 편집을 연다. */
export const ADMIN: Partial<AuthContextValue> = { isAdmin: true, hasRole: (r: string) => r === 'ADMIN' }
