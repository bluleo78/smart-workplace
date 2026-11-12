import { Outlet } from 'react-router-dom'

import { MobileSidebarSheet } from '@/components/mobile/MobileSidebarSheet'
import { usePrefetchMailSignature } from '@/hooks/queries/useMailSignature'

import { MailSidebar } from './MailSidebar'

/**
 * 메일 모듈 레이아웃 — 좌측 사이드바 + Outlet.
 * MailComposeProvider/MailComposeDock 은 AppLayout 수준으로 이동(#183):
 * 메일 모듈 이탈 시에도 draft 상태를 유지하기 위함.
 */
export function MailModuleLayout() {
  // 작성창이 열리기 전에 내 서명을 받아 둔다(WP-1517) — 열 때 캐시에 있으면 처음 본문에 서명이 바로 들어간다.
  usePrefetchMailSignature()
  return (
    <div className="flex h-full min-h-0 flex-1">
      {/* 모바일: 사이드바는 바텀시트(☰), 데스크톱: 기존 가로 배치 */}
      <MobileSidebarSheet title="메일" sidebar={<MailSidebar />} widthKey="mail">
        <div className="min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
      </MobileSidebarSheet>
    </div>
  )
}
