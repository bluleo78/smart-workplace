import { ResponsiveModuleLayout } from '@/components/mobile/ResponsiveModuleLayout'

import { DriveSidebar } from './DriveSidebar'

/** 드라이브 모듈 레이아웃 — 좌측 공간 목록 + Outlet(폴더 브라우저). */
export function DriveModuleLayout() {
  return <ResponsiveModuleLayout sidebar={<DriveSidebar />} rootPath="/drive" title="드라이브" />
}
