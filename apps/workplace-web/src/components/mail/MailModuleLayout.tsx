import { Outlet } from 'react-router-dom'

import { MailSidebar } from './MailSidebar'

/** 메일 모듈 레이아웃 — 좌측 2차 사이드바(계정 목록) + Outlet(받은편지함). */
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
