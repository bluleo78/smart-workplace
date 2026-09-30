// apps/workplace-web/src/components/layout/SettingsModuleLayout.tsx
// 설정 라우트 레이아웃 — 2차 사이드바(SettingsSidebar) + 콘텐츠.
import { ResponsiveModuleLayout } from '@/components/mobile/ResponsiveModuleLayout'

import { SettingsSidebar } from './SettingsSidebar'

export function SettingsModuleLayout() {
  return <ResponsiveModuleLayout sidebar={<SettingsSidebar />} rootPath="/settings" title="설정" scroll="none" />
}
