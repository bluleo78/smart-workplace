// 프로젝트 「노트」 탭(WP-1481) — 프로젝트의 노트 공간(트리 + 페이지)을 탭 본문에 가로 둘로 띄운다.
// 노트 컴포넌트는 그대로 쓰고, 주소 규칙(WikiRoutesProvider)만 `/projects/:key/notes[/:pageId]` 로 바꿔 끼운다.
// 공간이 없으면(404, 멤버 아님·공간 없음) 탭이 없는 것과 같아 프로젝트 이슈 탭으로 보낸다. 개인 프로젝트는 ProjectTabsLayout 이 먼저 돌려보내므로 여기 오지 않는다.
import { useMemo } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { LoadErrorState } from '@/components/LoadErrorState'
import { mobileSidebarListBaseClass, mobileWikiListClass } from '@/components/mobile/sidebarListClass'
import { Skeleton } from '@/components/ui/skeleton'
import { WikiPageUnavailableState, WikiPageView } from '@/components/wiki/WikiPageView'
import { projectWikiRoutes, WikiRoutesProvider } from '@/components/wiki/WikiRoutesContext'
import { WikiSidebar } from '@/components/wiki/WikiSidebar'
import { useWikiProjectSpace } from '@/hooks/queries/useWikiProjectSpace'
import { useWikiTree } from '@/hooks/queries/useWikiTree'
import { useIsMobile } from '@/hooks/useIsMobile'
import { isNotFoundError } from '@/lib/api-error'
import { parseId } from '@/lib/historyParam'
import { failedWithoutData } from '@/lib/queryFailure'
import { cn } from '@/lib/utils'
import { topLevelPages } from '@/lib/wikiTree'

import { projectTabPath } from './projectTabs'
import { useProjectTabs } from './ProjectTabsContext'

/** 프로젝트 노트 탭 — 공간 조회 결과에 따라 이동·오류 안내·화면을 가른다. */
export default function ProjectNotesTab() {
  const { project } = useProjectTabs()
  const space = useWikiProjectSpace(project.key)
  const issuesPath = projectTabPath(project.key, 'issues')

  // 이미 받은 공간이 있으면 백그라운드 재조회가 실패해도(500·404) 그대로 그린다 — 편집 중인 화면을 오류로 바꾸거나 튕기지 않는다.
  // 오류·404 판정은 데이터가 없을 때만 한다.
  if (!space.data) {
    // 공간 없음(404, 멤버 아님·공간 없음)도 탭이 없는 것과 같다.
    if (space.isError && isNotFoundError(space.error)) return <Navigate replace to={issuesPath} />
    // 첫 조회 실패 — 다시 시도로 부르는 동안에도 안내를 유지한다(failedWithoutData).
    if (failedWithoutData(space)) {
      return (
        <LoadErrorState
          title="노트 공간을 불러오지 못했습니다"
          queries={[space]}
          className="flex-1"
          testId="project-notes-error"
        />
      )
    }
    return <p className="w-full p-6 text-muted-foreground">로딩 중…</p>
  }
  return <NotesBody projectKey={project.key} spaceId={space.data.id} />
}

/** 공간을 알게 된 뒤의 본문 — 트리(왼쪽)와 페이지(오른쪽). 주소 규칙은 프로젝트 탭 기준. */
function NotesBody({ projectKey, spaceId }: { projectKey: string; spaceId: number }) {
  const navigate = useNavigate()
  const { pageId: pageIdParam } = useParams()
  const pageId = parseId(pageIdParam ?? null)
  const base = projectTabPath(projectKey, 'notes')
  const tree = useWikiTree(spaceId)
  const isMobile = useIsMobile()
  // 노트 컴포넌트에 끼우는 주소 규칙 — 공간·기준 주소가 같으면 한 번만 만든다(Provider 값이 매번 바뀌어 다시 그려지지 않게).
  const routes = useMemo(() => projectWikiRoutes(spaceId, base), [spaceId, base])

  // 주소의 번호가 양의 정수가 아니면 없는 페이지 안내(노트 앱 WikiPage 와 같은 규칙).
  if (pageIdParam != null && pageId == null) {
    return (
      <div className="flex min-h-0 flex-1">
        <WikiPageUnavailableState onBack={() => navigate(base)} />
      </div>
    )
  }

  // 모바일 목록(페이지 없음) — 노트 앱처럼 주소가 화면을 가른다: 페이지 없음 = 트리 전체(목록), 페이지 있음 = 페이지 전체(상세).
  // 자동 이동도 없다(WP-1481 5). 뒤로가기는 lib/mobile/routes. 노트 앱 모바일 목록(WikiModuleLayout)과 같은 규격이되,
  // embedded 사이드바의 첫 줄은 앱 제목이 아니라 도구줄이라 「첫 줄 숨김」이 빠진 기본 클래스를 쓴다.
  if (isMobile && pageIdParam == null) {
    return (
      <WikiRoutesProvider value={routes}>
        <div className="flex min-h-0 flex-1 flex-col" data-testid="project-notes-tab">
          <div data-testid="mobile-module-list" className={cn(mobileSidebarListBaseClass, mobileWikiListClass)}>
            <WikiSidebar spaceId={spaceId} activePageId={null} embedded />
          </div>
        </div>
      </WikiRoutesProvider>
    )
  }

  // 데스크톱의 페이지 없는 /notes(탭 클릭) — 첫 최상위 페이지로 replace 이동한다. 마지막으로 본 기록은 쓰지 않는다(노트 앱의 복원 위치를 건드리지 않는다).
  const desktopIndex = !isMobile && pageIdParam == null
  const first = desktopIndex && tree.data ? topLevelPages(tree.data)[0] : null
  if (first) return <Navigate replace to={`${base}/${first.id}`} />

  // 오른쪽 칸(모바일은 페이지 전체 화면) — 페이지 없는 데스크톱 /notes 에서만 트리 상태를 먼저 본다:
  // 트리를 못 받았으면 빈 상태(「새 페이지 만들기」)로 보여 페이지가 없는 것으로 오해하니 다시 시도 가능한 오류를,
  // 아직 받는 중이면 빈 상태가 잠깐 비치지 않게 스켈레톤을 둔다.
  const pane =
    desktopIndex && failedWithoutData(tree) ? (
      <LoadErrorState
        title="노트 목록을 불러오지 못했습니다"
        queries={[tree]}
        className="flex-1"
        testId="project-notes-tree-error"
      />
    ) : desktopIndex && tree.isPending ? (
      <div className="p-6" data-testid="project-notes-loading">
        <Skeleton className="h-8 w-1/3" />
      </div>
    ) : (
      <WikiPageView pageId={pageId} spaceId={spaceId} recordLastVisited={false} />
    )

  return (
    <WikiRoutesProvider value={routes}>
      <div className="flex min-h-0 flex-1" data-testid="project-notes-tab">
        {!isMobile && <WikiSidebar spaceId={spaceId} activePageId={pageId} embedded />}
        <div className="flex min-w-0 flex-1 flex-col">{pane}</div>
      </div>
    </WikiRoutesProvider>
  )
}
