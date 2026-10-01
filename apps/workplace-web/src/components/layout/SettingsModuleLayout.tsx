// apps/workplace-web/src/components/layout/SettingsModuleLayout.tsx
// 설정 라우트 레이아웃 — 2차 사이드바(SettingsSidebar) + 콘텐츠.
import { ResponsiveModuleLayout } from '@/components/mobile/ResponsiveModuleLayout'
import { mobileSettingsListClass } from '@/components/mobile/sidebarListClass'

import { SettingsSidebar } from './SettingsSidebar'

export function SettingsModuleLayout() {
  // 모바일 설정 목록은 행 끝에 › 를 붙여 하위 화면 진입을 드러낸다(U2-4) — 사이드바 DOM 은 데스크톱과 공유.
  return (
    <ResponsiveModuleLayout
      sidebar={<SettingsSidebar />}
      rootPath="/settings"
      title="설정"
      scroll="none"
      listClassName={mobileSettingsListClass}
    />
  )
}
