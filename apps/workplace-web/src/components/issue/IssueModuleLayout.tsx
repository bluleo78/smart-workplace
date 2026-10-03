// 이슈 라우트 레이아웃 — 2차 사이드바 + 콘텐츠.
import { useMemo } from 'react'

import { ResponsiveModuleLayout } from '@/components/mobile/ResponsiveModuleLayout'
import { useProjects } from '@/hooks/queries/useProjects'
import { useMyPinnedViews } from '@/hooks/queries/useSavedViews'
import { buildTaskListContext } from '@/lib/aiScreenContext/builders/mobileLists'

import { IssueSidebar } from './IssueSidebar'

export function IssueModuleLayout() {
  // WP-191: 모바일 작업 목록의 화면 컨텍스트 — 프로젝트·고정 보기 이름(쿼리는 사이드바·위젯과 캐시 공유).
  const projects = useProjects()
  const pinned = useMyPinnedViews()
  const listCtx = useMemo(
    () => buildTaskListContext({
      projects: (projects.data?.content ?? []).map((p) => p.name),
      pinnedViews: (pinned.data ?? []).map((v) => v.name),
    }),
    [projects.data, pinned.data],
  )
  // title 은 모바일 전용(목록 큰 제목·뒤로가기 바) — 탭 라벨 "작업" 과 맞춘다(U1-8). 데스크톱 사이드바 제목("작업 관리")은 IssueSidebar 소관.
  return <ResponsiveModuleLayout sidebar={<IssueSidebar />} rootPath="/tasks" title="작업" listScreenContext={listCtx} />
}
