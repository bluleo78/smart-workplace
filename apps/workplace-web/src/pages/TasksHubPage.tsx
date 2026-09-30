// /tasks — 작업 관리 모듈 허브. 데스크톱은 기존 진입점(/me/tasks/assigned)으로 보내고,
// 모바일은 IssueModuleLayout 이 rootPath('/tasks') 에서 사이드바 목록을 그리므로 본문이 필요 없다.
import { Navigate } from 'react-router-dom'

import { useIsMobile } from '@/hooks/useIsMobile'

export function TasksHubPage() {
  const isMobile = useIsMobile()
  return isMobile ? null : <Navigate to="/me/tasks/assigned" replace />
}
