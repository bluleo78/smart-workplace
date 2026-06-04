import { Outlet } from 'react-router-dom'

import { MailComposeProvider } from './MailComposeContext'
import { MailComposeDock } from './MailComposeDock'
import { MailSidebar } from './MailSidebar'

/** 메일 모듈 레이아웃 — 좌측 사이드바 + Outlet + 작성 도크(Provider 로 전역 오픈). */
export function MailModuleLayout() {
  return (
    <MailComposeProvider>
      <div className="flex h-full min-h-0 flex-1">
        <MailSidebar />
        <div className="min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
      </div>
      <MailComposeDock />
    </MailComposeProvider>
  )
}
