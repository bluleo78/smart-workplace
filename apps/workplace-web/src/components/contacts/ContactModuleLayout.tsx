import { Outlet } from 'react-router-dom'

import { ContactSidebar } from './ContactSidebar'

/** 연락처 모듈 레이아웃 — 좌측 2차 사이드바(검색·필터) + Outlet(통합 목록/상세). */
export function ContactModuleLayout() {
  return (
    <div className="flex h-full min-h-0 flex-1">
      <ContactSidebar />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}
