import { Outlet } from 'react-router-dom'

import { MobileSidebarSheet } from '@/components/mobile/MobileSidebarSheet'

import { ContactSidebar } from './ContactSidebar'

/** 연락처 모듈 레이아웃 — 좌측 2차 사이드바(보기 선택 — 타입·그룹. 검색은 페이지 헤더, WP-976) + Outlet(통합 목록/상세). */
export function ContactModuleLayout() {
  return (
    <div className="flex h-full min-h-0 flex-1">
      {/* 모바일: 사이드바는 바텀시트(☰), 데스크톱: 기존 가로 배치 */}
      <MobileSidebarSheet title="연락처" sidebar={<ContactSidebar />} widthKey="contacts">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </MobileSidebarSheet>
    </div>
  )
}
