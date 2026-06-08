import { Outlet } from 'react-router-dom'

import { MailSidebar } from './MailSidebar'

/**
 * 메일 모듈 레이아웃 — 좌측 사이드바 + Outlet.
 * MailComposeProvider/MailComposeDock 은 AppLayout 수준으로 이동(#183):
 * 메일 모듈 이탈 시에도 draft 상태를 유지하기 위함.
 */
export function MailModuleLayout() {
  return (
    <div className="flex h-full min-h-0 flex-1">
      <MailSidebar />
      <div className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  )
}
