// apps/workplace-web/src/components/layout/SettingsModuleLayout.tsx
// 설정 라우트 레이아웃 — 2차 사이드바(SettingsSidebar) + 콘텐츠.
import { Outlet } from 'react-router-dom'

import { SettingsSidebar } from './SettingsSidebar'

export function SettingsModuleLayout() {
  return (
    <div className="flex h-full min-h-0 flex-1">
      <SettingsSidebar />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
