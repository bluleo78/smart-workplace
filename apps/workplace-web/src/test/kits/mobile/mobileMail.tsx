// 모바일 메일 화면 테스트 공용 렌더(WP-1002) — 앱 셸 없이 메일 모듈(레이아웃 + 받은편지함)과 작성 도크만 띄운다.
// 답장·전달 작성 화면은 AppLayout 이 앱 전역에 두는 MailComposeDock 이 그리므로 도크도 같이 그린다(작성 상태 Provider 는 d-screen 이 감싼다).
import { Route, Routes } from 'react-router-dom'

import { MailComposeDock } from '@/components/mail/MailComposeDock'
import { MailModuleLayout } from '@/components/mail/MailModuleLayout'
import { MailInboxPage } from '@/pages/mail/MailInboxPage'
import type { renderScreen } from '@/test/renderScreen'

import { renderMobileScreen } from './mobileScreen'

/** path(기본 /mail/1)로 메일 화면을 띄운다. handlers 는 앱 셸 기본 응답보다 우선한다. */
export function renderMobileMail(path = '/mail/1', options: Parameters<typeof renderScreen>[1] = {}) {
  return renderMobileScreen(
    <>
      {/* AppLayout 처럼 페이지 영역 표식 — 작성 화면이 이 안을 inert 로 만든다. 도크는 이 바깥(앱 전역)에 둔다. */}
      <div data-ai-page-root>
        <Routes>
          <Route element={<MailModuleLayout />}>
            <Route path="/mail" element={<MailInboxPage />} />
            <Route path="/mail/:accountId" element={<MailInboxPage />} />
          </Route>
        </Routes>
      </div>
      <MailComposeDock />
    </>,
    { ...options, path },
  )
}
