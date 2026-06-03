import { Outlet } from 'react-router-dom'

import { DriveSidebar } from './DriveSidebar'

/** 드라이브 모듈 레이아웃 — 좌측 공간 목록 + Outlet(폴더 브라우저). */
export function DriveModuleLayout() {
  return (
    <div className="flex h-full min-h-0 flex-1">
      <DriveSidebar />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}
