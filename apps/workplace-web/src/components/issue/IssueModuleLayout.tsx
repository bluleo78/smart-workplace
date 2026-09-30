// 이슈 라우트 레이아웃 — 2차 사이드바 + 콘텐츠.
import { ResponsiveModuleLayout } from '@/components/mobile/ResponsiveModuleLayout'

import { IssueSidebar } from './IssueSidebar'

export function IssueModuleLayout() {
  return <ResponsiveModuleLayout sidebar={<IssueSidebar />} rootPath="/tasks" title="작업 관리" />
}
