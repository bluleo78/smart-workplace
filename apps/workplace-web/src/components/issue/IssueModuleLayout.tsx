// 이슈 라우트 레이아웃 — 2차 사이드바 + 콘텐츠.
import { useMemo } from 'react'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { ResponsiveModuleLayout } from '@/components/mobile/ResponsiveModuleLayout'
import { useAllProjects } from '@/hooks/queries/useProjects'
import { useMyPinnedViews } from '@/hooks/queries/useSavedViews'
import { useIsSidebarCompact } from '@/hooks/useIsSidebarCompact'
import { buildTaskListContext } from '@/lib/aiScreenContext/builders/mobileLists'

import { IssueSidebar } from './IssueSidebar'

export function IssueModuleLayout() {
  // title 은 모바일 전용(목록 큰 제목·뒤로가기 바) — 탭 라벨 "작업" 과 맞춘다(U1-8). 데스크톱 사이드바 제목("작업 관리")은 IssueSidebar 소관.
  // 좁은 데스크톱 창(1280px 미만)에선 사이드바를 아이콘 줄로 접어 이슈 목록 제목 칸을 넓힌다(WP-506). 에픽 패널은 그대로 둔다.
  const compact = useIsSidebarCompact()
  return <ResponsiveModuleLayout sidebar={<IssueSidebar />} compactSidebar={compact ? <IssueSidebar compact /> : undefined} widthKey="tasks" rootPath="/tasks" title="작업" listContext={<TaskListScreenContext />} />
}

/** WP-191: 모바일 작업 목록의 화면 컨텍스트 등록기 — 프로젝트·고정 보기 이름(전체 프로젝트 쿼리는 사이드바와 캐시 공유). 모바일 목록 분기에서만 마운트. */
function TaskListScreenContext() {
  const projects = useAllProjects()
  const pinned = useMyPinnedViews()
  const ctx = useMemo(
    () => buildTaskListContext({
      projects: (projects.data?.content ?? []).map((p) => p.name),
      pinnedViews: (pinned.data ?? []).map((v) => v.name),
    }),
    [projects.data, pinned.data],
  )
  useRegisterAiScreenContext(ctx)
  return null
}
