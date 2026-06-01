// 이슈 모듈 2차 사이드바 — 개인 영역(내 작업/AI 위임) + 프로젝트(컬러 식별자).
import { LayoutList, ListChecks, Plus, Sparkles } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { sidebarLinkClass, sidebarTitleClass } from '@/components/layout/sidebar-link'
import { useProjects } from '@/hooks/queries/useProjects'
import { projectColor, projectInitial } from '@/lib/project-color'

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
        {/* 개인 영역 — 경쟁 솔루션 공통 패턴: 개인 작업을 사이드바 최상단에 고정 */}
        <nav className="space-y-1">
          <NavLink to="/me/tasks" className={sidebarLinkClass}>
            <ListChecks className="h-4 w-4" /> 내 작업
          </NavLink>
          <NavLink to="/me/ai-tasks" className={sidebarLinkClass}>
            <Sparkles className="h-4 w-4" /> AI 위임 작업
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
            {(projects.data?.content ?? []).map((p) => {
              // 백엔드에 색상 필드가 없어 key 해시로 결정적 컬러 식별자 생성(아이콘 일관성).
              const c = projectColor(p.key)
              return (
                <NavLink key={p.id} to={`/projects/${p.key}`} className={sidebarLinkClass}>
                  <span
                    aria-hidden="true"
                    data-testid={`project-badge-${p.key}`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold"
                    style={{ backgroundColor: c.bg, color: c.fg }}
                  >
                    {projectInitial(p.key)}
                  </span>
                  <span className="truncate">{p.name}</span>
                </NavLink>
              )
            })}
          </nav>
        </div>
      </div>
    </aside>
  )
}
