// /me/tasks(탭 없는 주소) — 마지막에 본 탭으로, 기억이 없으면(첫 방문) 개요로 보낸다(WP-1484).
// 작업 관리 사이드바 「내 작업」과 /tasks 허브가 이 주소로 들어온다. 쿼리(필터)는 그대로 넘긴다.
import { Navigate, useLocation } from 'react-router-dom'

import { readLastMyTasksTab, useMyTasksTabKey } from './myTasksLastTab'

export default function MyTasksIndexRedirect() {
  const key = useMyTasksTabKey()
  const { search } = useLocation()
  return <Navigate to={{ pathname: `/me/tasks/${readLastMyTasksTab(key)}`, search }} replace />
}
