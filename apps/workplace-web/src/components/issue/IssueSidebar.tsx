// 이슈 모듈 2차 사이드바 — 개인 영역(내 작업/AI 위임) + 프로젝트(컬러 식별자).
import { LayoutGrid, LayoutList, ListChecks, Plus, Sparkles, Star } from 'lucide-react'
import { useState } from 'react'
import { NavLink } from 'react-router-dom'

import { ProjectCreateDialog } from '@/pages/projects/components/ProjectCreateDialog'

import { sidebarLinkClass, sidebarTitleClass } from '@/components/layout/sidebar-link'
import { useProjects } from '@/hooks/queries/useProjects'
import { useMyPinnedViews } from '@/hooks/queries/useSavedViews'
import { useProjectFavorites } from '@/hooks/useProjectFavorites'
import { projectColor, projectInitial } from '@/lib/project-color'

export function IssueSidebar() {
  // 프로젝트 생성 다이얼로그 열림 상태 — 섹션 헤더 + 버튼이 트리거한다.
  const [createOpen, setCreateOpen] = useState(false)
  // 프로젝트 목록은 PageResponse<ProjectResponse> 형태 — data.content 로 접근한다.
  const projects = useProjects()
  // 사용자가 고정한 뷰 — 프로젝트 교차 빠른 접근(사이드바 상단 노출).
  const pinned = useMyPinnedViews()

  // 즐겨찾기(localStorage) — 사이드바 팀 프로젝트 목록은 즐겨찾기한 것만 노출한다.
  const { isFav } = useProjectFavorites()

  // 프로젝트를 개인(PERSONAL)/팀(TEAM)으로 분리. 개인은 항상 노출, 팀은 즐겨찾기만.
  const all = projects.data?.content ?? []
  const personal = all.filter((p) => p.type === 'PERSONAL')
  const favTeam = all.filter((p) => p.type !== 'PERSONAL' && isFav(p.key))

  return (
    <>
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

        {(pinned.data?.length ?? 0) > 0 && (
          <div className="mt-5" data-testid="sidebar-pinned-views">
            <div className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              고정된 뷰
            </div>
            <nav className="mt-2 space-y-1">
              {(pinned.data ?? []).map((v) => (
                <NavLink
                  key={v.id}
                  to={`/projects/${v.projectKey}?${v.query}`}
                  data-testid={`pinned-view-${v.id}`}
                  className={sidebarLinkClass}
                >
                  <Star className="h-4 w-4 shrink-0 fill-current text-muted-foreground" />
                  <span className="truncate">{v.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{v.projectKey}</span>
                </NavLink>
              ))}
            </nav>
          </div>
        )}

        {/* 개인 영역 — 소유자 전용 비공개 개인 프로젝트(멤버 없음) 그룹. */}
        {personal.length > 0 && (
          <div className="mt-5" data-testid="sidebar-personal-projects">
            <div className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              개인
            </div>
            <nav className="mt-2 space-y-1">
              {personal.map((p) => {
                // 백엔드에 색상 필드가 없어 key 해시로 결정적 컬러 식별자 생성(아이콘 일관성).
                const c = projectColor(p.key)
                return (
                  <NavLink
                    key={p.id}
                    to={`/projects/${p.key}`}
                    data-testid={`personal-project-${p.key}`}
                    className={sidebarLinkClass}
                  >
                    <span
                      aria-hidden="true"
                      data-testid={`project-badge-${p.key}`}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs font-bold"
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
        )}

        <div className="mt-5">
          <div className="flex items-center justify-between px-3">
            {/* 평범한 섹션 라벨(클릭 불가) — 진입로는 아래 "전체 보기" 항목이 담당 */}
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              프로젝트
            </span>
            {/* + 버튼: 새 프로젝트 생성 트리거 */}
            <button
              type="button"
              data-testid="sidebar-create-project"
              aria-label="새 프로젝트"
              onClick={() => setCreateOpen(true)}
              className="p-1 text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <nav className="mt-2 space-y-1">
            {/* 첫 항목 = 전체 보기(전체 목록 /projects 진입로) */}
            <NavLink
              to="/projects"
              end
              data-testid="sidebar-all-projects"
              className={sidebarLinkClass}
            >
              <LayoutGrid className="h-4 w-4" /> 전체 보기
            </NavLink>
            {/* 즐겨찾기한 팀 프로젝트만 노출(전체는 위 "전체 보기"). 개인 프로젝트는 위 "개인" 섹션에 항상 노출. */}
            {favTeam.map((p) => {
              // 백엔드에 색상 필드가 없어 key 해시로 결정적 컬러 식별자 생성(아이콘 일관성).
              const c = projectColor(p.key)
              return (
                <NavLink
                  key={p.id}
                  to={`/projects/${p.key}`}
                  className={sidebarLinkClass}
                  data-testid={`team-project-${p.key}`}
                >
                  <span
                    aria-hidden="true"
                    data-testid={`project-badge-${p.key}`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs font-bold"
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
    {/* 프로젝트 생성 다이얼로그 — aside 형제로 렌더해 z-index 스택 충돌 방지 */}
    <ProjectCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}
