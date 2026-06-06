import { Outlet } from 'react-router-dom'

/** 캘린더 모듈 — 풀높이 컨테이너(사이드바는 페이지가 상태와 함께 렌더). */
export function CalendarModuleLayout() {
  return (
    <div className="flex h-full min-h-0 flex-1">
      <Outlet />
    </div>
  )
}
