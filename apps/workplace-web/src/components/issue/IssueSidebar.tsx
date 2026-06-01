// 이슈 모듈 2차 사이드바 — cross-project 내 태스크 + 프로젝트 목록. 어느 보드에서든 즉시 전환.
import { LayoutList, ListChecks, Plus } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { sidebarLinkClass, sidebarTitleClass } from '@/components/layout/sidebar-link'
import { useProjects } from '@/hooks/queries/useProjects'

export function IssueSidebar() {
  // 프로젝트 목록은 PageResponse<ProjectResponse> 형태 — data.content 로 접근한다.
  const projects = useProjects()

  return (
    <aside
      className="flex w-56 shrink-0 flex-col border-r bg-sidebar/40"
      data-testid="issue-sidebar"
    >
      {/* 앱 타이틀 헤더 — 레일과 동일한 앱 아이콘 + 이름으로 "작업 관리" 앱임을 명시(Slack 모델) */}
      <div className={sidebarTitleClass}>
        <LayoutList className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
        작업 관리
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <nav className="space-y-1">
          <NavLink to="/me/watched" className={sidebarLinkClass}>
            <ListChecks className="h-4 w-4" /> 내 태스크
          </NavLink>
        </nav>

        <div className="mt-5">
          <div className="flex items-center justify-between px-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              프로젝트
            </span>
            <NavLink
              to="/projects"
              aria-label="프로젝트 전체 보기"
              className="text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
            </NavLink>
          </div>
          <nav className="mt-2 space-y-1">
            {(projects.data?.content ?? []).map((p) => (
              <NavLink key={p.id} to={`/projects/${p.key}`} className={sidebarLinkClass}>
                <span className="truncate">{p.name}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
    </aside>
  )
}
