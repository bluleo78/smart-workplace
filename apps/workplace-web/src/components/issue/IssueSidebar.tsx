// 이슈 모듈 2차 사이드바 — 개인 영역(내 작업/AI 위임) + 프로젝트(컬러 식별자).
// 좁은 데스크톱 창에선 compact(아이콘 줄, 56px)로 그린다(WP-506) — 이름은 숨기고 마우스를 올리면 Tooltip 으로 보인다.
// compact 분기는 아래 SidebarItem(항목)·SidebarSection(섹션 머리말) 두 곳에만 둔다.
import { LayoutGrid, LayoutList, ListChecks, Plus, Sparkles, Star } from 'lucide-react'
import { lazy, type ReactElement, type ReactNode, Suspense, useState } from 'react'
import { Link, NavLink, type NavLinkProps, useLocation } from 'react-router-dom'

import { sidebarLinkClass, sidebarTitleClass } from '@/components/layout/sidebar-link'
import { ProjectBadge } from '@/components/ProjectBadge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAllProjects } from '@/hooks/queries/useProjects'
import { useMyPinnedViews } from '@/hooks/queries/useSavedViews'
import { useProjectFavorites } from '@/hooks/useProjectFavorites'
import { queriesEqualIgnoringView, type SavedViewLinkState, savedViewQueryToParams } from '@/lib/savedViewQuery'
import { cn } from '@/lib/utils'

/** compact 에서 아이콘을 칸 가운데에 두는 클래스 — 링크·제목 헤더가 함께 쓴다. */
const COMPACT_CENTER = 'justify-center px-0'

/** compact 에서 항목 이름을 오른쪽 Tooltip 으로 보인다(앱 레일 축소 상태와 같은 방식). 펼친 상태에선 그대로 둔다. */
function CompactTip({ compact, label, children }: { compact: boolean; label: string; children: ReactElement }) {
  if (!compact) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * NavLink 의 활성 판정 className 함수를 linkClass 로 받는 얇은 래퍼. Tooltip 트리거(Radix Slot)는 자식의 className 을
 * 문자열로 합치는데, NavLink 의 함수형 className 이 그대로 문자열이 되어 여백·선택 표시가 사라졌다 — className 을 Slot 이
 * 보지 않는 prop 으로 옮겨 피한다. ref·이벤트 핸들러 등 Slot 이 주는 나머지 props 는 NavLink 로 넘긴다(React 19 의 ref prop).
 */
function SidebarNavLink({ linkClass, ...props }: Omit<NavLinkProps, 'className'> & { linkClass: NavLinkProps['className'] }) {
  return <NavLink {...props} className={linkClass} />
}

/**
 * 사이드바 항목 하나 — 아이콘 + 이름(+ 꼬리 글자). compact 면 아이콘만 가운데 두고 이름은 sr-only 로 남겨 접근 가능한 이름을 지키며,
 * Tooltip 으로 보인다(tip 이 있으면 그 글로). active 를 주면 NavLink 의 경로 판정 대신 그 값으로 선택을 그린다(고정 뷰, WP-607).
 */
function SidebarItem({
  compact,
  to,
  end,
  icon,
  label,
  tip,
  trailing,
  active,
  state,
  testId,
}: {
  compact: boolean
  to: string
  end?: boolean
  icon: ReactNode
  label: string
  tip?: string
  trailing?: string
  active?: boolean
  /** 링크 이동에 실어 보낼 history state — 고정 뷰는 연 뷰 id 를 넘긴다(SavedViewLinkState, WP-1022). */
  state?: unknown
  testId?: string
}) {
  const classFor = (isActive: boolean) => cn(sidebarLinkClass({ isActive }), compact && COMPACT_CENTER)
  const content = (
    <>
      {icon}
      <span className={compact ? 'sr-only' : 'truncate'}>{label}</span>
      {trailing && <span className={compact ? 'sr-only' : 'ml-auto shrink-0 text-xs text-muted-foreground'}>{trailing}</span>}
    </>
  )
  return (
    <CompactTip compact={compact} label={tip ?? label}>
      {active === undefined ? (
        <SidebarNavLink to={to} end={end} data-testid={testId} linkClass={({ isActive }) => classFor(isActive)}>
          {content}
        </SidebarNavLink>
      ) : (
        <Link to={to} state={state} data-testid={testId} className={classFor(active)} aria-current={active ? 'page' : undefined}>
          {content}
        </Link>
      )}
    </CompactTip>
  )
}

/**
 * 섹션(고정된 뷰·개인·프로젝트) — 머리말 + 항목 목록. compact 면 라벨 글자가 56px 에 들어가지 않아 구분선으로 대신하고,
 * 머리말 버튼(action)은 구분선 아래 아이콘 칸으로 둔다. 펼친 상태의 머리말 DOM(.justify-between 줄 > .uppercase 라벨 + 버튼)은
 * 모바일 목록 래퍼(sidebarListClass)가 기대는 구조 규약이라 그대로 지킨다.
 */
function SidebarSection({
  compact,
  label,
  action,
  testId,
  children,
}: {
  compact: boolean
  label: string
  action?: ReactNode
  testId?: string
  children: ReactNode
}) {
  const labelClass = 'text-xs font-semibold uppercase tracking-wider text-muted-foreground'
  return (
    <div className={compact ? 'mt-3' : 'mt-5'} data-testid={testId}>
      {compact ? (
        <>
          <div aria-hidden="true" className="mx-2 border-t" />
          {action && <div className="mt-3">{action}</div>}
        </>
      ) : action ? (
        <div className="flex items-center justify-between px-3">
          <span className={labelClass}>{label}</span>
          {action}
        </div>
      ) : (
        <div className={cn('px-3', labelClass)}>{label}</div>
      )}
      <nav className={cn(compact ? (action ? 'mt-1' : 'mt-3') : 'mt-2', 'space-y-1')}>{children}</nav>
    </div>
  )
}

// 프로젝트 생성 다이얼로그는 처음 열 때 불러온다(WP-970) — 폼 검증(zod·react-hook-form)이 이슈 화면 첫 부팅에 실리지 않게.
const ProjectCreateDialog = lazy(() =>
  import('@/pages/projects/components/ProjectCreateDialog').then((m) => ({ default: m.ProjectCreateDialog })),
)

export function IssueSidebar({ compact = false }: { compact?: boolean }) {
  // 프로젝트 생성 다이얼로그 열림 상태 — 섹션 헤더 + 버튼이 트리거한다.
  const [createOpen, setCreateOpen] = useState(false)
  // 한 번 연 다이얼로그는 계속 마운트해 둔다 — 닫힘 전환·폼 초기화가 예전과 같게.
  const [createMounted, setCreateMounted] = useState(false)
  if (createOpen && !createMounted) setCreateMounted(true)
  // 프로젝트 목록은 PageResponse<ProjectResponse> 형태 — data.content 로 접근한다.
  const projects = useAllProjects()
  // 사용자가 고정한 뷰 — 프로젝트 교차 빠른 접근(사이드바 상단 노출).
  const pinned = useMyPinnedViews()
  // 고정 뷰 활성 판정(WP-607) — NavLink 는 쿼리를 보지 않고 경로 접두만 맞춰, 그 프로젝트의 어느 화면(전체 목록·설정)에서도
  // 고정 뷰가 모두 선택돼 보였다. 프로젝트 목록 경로가 정확히 같고 필터 쿼리가 뷰와 같을 때만(뷰 칩과 같은 기준) 선택으로
  // 보고, 링크도 NavLink 대신 Link + 직접 계산한 aria-current 로 그린다(NavLink 는 자체 판정으로 aria-current 를 붙인다).
  const location = useLocation()

  // 즐겨찾기(서버 저장, WP-1001) — 사이드바 팀 프로젝트 목록은 즐겨찾기한 것만 노출한다.
  const { isFav } = useProjectFavorites()

  // 프로젝트를 개인(PERSONAL)/팀(TEAM)으로 분리. 개인은 항상 노출, 팀은 즐겨찾기만.
  const all = projects.data?.content ?? []
  const personal = all.filter((p) => p.type === 'PERSONAL')
  const favTeam = all.filter((p) => p.type !== 'PERSONAL' && isFav(p.key))

  return (
    <TooltipProvider delayDuration={200}>
    <aside
      className={cn('flex shrink-0 flex-col border-r bg-sidebar/40', compact ? 'w-14' : 'w-56')}
      data-testid="issue-sidebar"
      data-compact={compact || undefined}
    >
      {/* 앱 타이틀 헤더 — 레일과 동일한 앱 아이콘 + 이름으로 "작업 관리" 앱임을 명시(Slack 모델). compact 는 아이콘만 */}
      <div className={cn(sidebarTitleClass, compact && COMPACT_CENTER)}>
        <LayoutList className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
        <span className={compact ? 'sr-only' : undefined}>작업 관리</span>
      </div>

      <div className={cn('flex-1 overflow-y-auto', compact ? 'p-2' : 'p-3')}>
        {/* 개인 영역 — 경쟁 솔루션 공통 패턴: 개인 작업을 사이드바 최상단에 고정 */}
        <nav className="space-y-1">
          <SidebarItem compact={compact} to="/me/tasks" icon={<ListChecks className="h-4 w-4 shrink-0" />} label="내 작업" />
          <SidebarItem compact={compact} to="/me/ai-tasks" icon={<Sparkles className="h-4 w-4 shrink-0" />} label="AI 위임 작업" />
        </nav>

        {(pinned.data?.length ?? 0) > 0 && (
          <SidebarSection compact={compact} label="고정된 뷰" testId="sidebar-pinned-views">
            {(pinned.data ?? []).map((v) => (
              <SidebarItem
                key={v.id}
                compact={compact}
                // group 없는 (사이클 그룹 도입 전) 저장 뷰는 group=none 을 붙여 예전처럼 평면 목록으로 연다(#878).
                to={`/projects/${v.projectKey}?${savedViewQueryToParams(v.query).toString()}`}
                // 연 뷰를 「고른 뷰」로 — 주소만으로는 칩을 누른 것과 구분되지 않아, 이슈 화면에 있을 때 누르면 고른 뷰로 잡히지 않았다(WP-1022).
                state={{ savedViewId: v.id } satisfies SavedViewLinkState}
                testId={`pinned-view-${v.id}`}
                active={
                  location.pathname === `/projects/${v.projectKey}` &&
                  queriesEqualIgnoringView(location.search, v.query)
                }
                icon={<Star className="h-4 w-4 shrink-0 fill-current text-muted-foreground" />}
                label={v.name}
                trailing={v.projectKey}
                tip={`${v.name} · ${v.projectKey}`}
              />
            ))}
          </SidebarSection>
        )}

        {/* 개인 영역 — 소유자 전용 비공개 개인 프로젝트(멤버 없음) 그룹. */}
        {personal.length > 0 && (
          <SidebarSection compact={compact} label="개인" testId="sidebar-personal-projects">
            {personal.map((p) => (
              <SidebarItem
                key={p.id}
                compact={compact}
                to={`/projects/${p.key}`}
                testId={`personal-project-${p.key}`}
                icon={<ProjectBadge projectKey={p.key} />}
                label={p.name}
              />
            ))}
          </SidebarSection>
        )}

        {/* 평범한 섹션 라벨(클릭 불가) — 진입로는 아래 "전체 보기" 항목이 담당 */}
        <SidebarSection
          compact={compact}
          label="프로젝트"
          action={
            // + 버튼: 새 프로젝트 생성 트리거
            <CompactTip compact={compact} label="새 프로젝트">
              <button
                type="button"
                data-testid="sidebar-create-project"
                aria-label="새 프로젝트"
                onClick={() => setCreateOpen(true)}
                className={cn(
                  'text-muted-foreground hover:text-foreground',
                  compact ? 'flex w-full justify-center rounded-md py-2 hover:bg-accent/50' : 'p-1',
                )}
              >
                <Plus className="h-4 w-4" />
              </button>
            </CompactTip>
          }
        >
          {/* 첫 항목 = 전체 보기(전체 목록 /projects 진입로) */}
          <SidebarItem
            compact={compact}
            to="/projects"
            end
            testId="sidebar-all-projects"
            icon={<LayoutGrid className="h-4 w-4 shrink-0" />}
            label="전체 보기"
          />
          {/* 즐겨찾기한 팀 프로젝트만 노출(전체는 위 "전체 보기"). 개인 프로젝트는 위 "개인" 섹션에 항상 노출. */}
          {favTeam.map((p) => (
            <SidebarItem
              key={p.id}
              compact={compact}
              to={`/projects/${p.key}`}
              testId={`team-project-${p.key}`}
              icon={<ProjectBadge projectKey={p.key} />}
              label={p.name}
            />
          ))}
        </SidebarSection>
      </div>
    </aside>
    {/* 프로젝트 생성 다이얼로그 — aside 형제로 렌더해 z-index 스택 충돌 방지 */}
    {createMounted && (
      <Suspense fallback={null}>
        <ProjectCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      </Suspense>
    )}
    </TooltipProvider>
  )
}
