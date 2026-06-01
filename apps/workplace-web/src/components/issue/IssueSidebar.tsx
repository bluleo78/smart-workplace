// 이슈 모듈 2차 사이드바 — cross-project 내 태스크 + 프로젝트 목록. 어느 보드에서든 즉시 전환.
import { ListChecks, Plus } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { useProjects } from '@/hooks/queries/useProjects'

import { sidebarLinkClass } from '../layout/sidebar-link'

export function IssueSidebar() {
  // 프로젝트 목록은 PageResponse<ProjectResponse> 형태 — data.content 로 접근한다.
  const projects = useProjects()

  return (
    <aside
      className="flex w-56 shrink-0 flex-col border-r bg-sidebar/40 p-3"
      data-testid="issue-sidebar"
    >
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
    </aside>
  )
}
