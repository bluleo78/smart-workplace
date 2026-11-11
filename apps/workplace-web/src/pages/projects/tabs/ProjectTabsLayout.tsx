// 프로젝트 화면 탭 레이아웃(WP-1477) — /projects/:key 와 그 탭 길(overview·timeline·cycles·versions)을 감싼다.
// 프로젝트 로딩·오류 화면, 개인/팀 분기(이 레이아웃에서만), 화면 틀(머리줄·탭 줄)과 새 태스크 대화상자를 맡고 본문은 <Outlet/>.
// 탭 사이를 오가도 이 레이아웃은 그대로라 머리줄·탭 줄이 다시 그려지지 않는다.
import { ArrowLeft, Plus } from 'lucide-react'
import { type ComponentProps, type ReactNode, Suspense, useMemo, useState } from 'react'
import { Link, Navigate, Outlet, useNavigate, useParams } from 'react-router-dom'

import { Page } from '@/components/layout/Page'
import { HeaderIconAction } from '@/components/mobile/HeaderIconAction'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

import { useProject } from '../../../hooks/queries/useProjects'
import { canCreateIssueIn } from '../../../lib/projectPermissions'
import type { ProjectResponse } from '../../../types/project'
import { IssueCreateDialog } from '../components/IssueCreateDialog'
import { ProjectUnavailableState } from '../components/ProjectUnavailableState'
import { useRememberedIssueQuery } from '../hooks/useRememberedIssueQuery'
import { PersonalProjectDetail } from '../personal/PersonalProjectDetail'
import { ProjectTabBar } from './ProjectTabBar'
import { PROJECT_TABS } from './projectTabs'
import { ProjectTabsContext, type ProjectTabsValue } from './ProjectTabsContext'
import { useRememberedProjectTab } from './useRememberedProjectTab'

/** 프로젝트·탭 본문 모듈을 처음 불러오는 동안 — 머리줄·탭 줄은 그대로 두고 본문 자리만 비운다(프로젝트 로딩도 같은 모양). */
const tabFallback = <p className="w-full p-6 text-muted-foreground">로딩 중…</p>

/**
 * 프로젝트 탭 레이아웃. 개인/팀 판단은 여기서만 한다 — 탭 화면들은 컨텍스트(useProjectTabs)로 불러온 프로젝트를 받는다.
 * - 팀·공개 프로젝트: 머리줄(이름·키·설정·+ 새 태스크)·탭 줄·마지막 탭 기억.
 * - 개인 프로젝트: 탭·기억 없음. 이슈 길은 자기 Page 를 그리는 개인 전용 화면을 바로 그리고, 타임라인·사이클·버전은
 *   main 과 같은 화면 머리줄(← 돌아가기·화면 이름)의 같은 틀로 감싼다. 개요 탭 주소는 이슈 화면으로 보낸다.
 */
export function ProjectTabsLayout() {
  const { key = '' } = useParams()
  const navigate = useNavigate()
  const project = useProject(key)
  const team = project.data != null && project.data.type !== 'PERSONAL'
  // 기억·되돌리기는 불러온 팀 프로젝트에서만 — 없거나 볼 수 없는 프로젝트·개인 프로젝트의 기억은 읽지도 쓰지도 않는다.
  // 지금 탭(tab)도 같이 받아 탭 줄·개인 분기에 그대로 쓴다(주소 해석을 두 번 하지 않는다).
  const { redirectTo, tab } = useRememberedProjectTab(key, team)

  // 새 태스크 대화상자 — 머리줄 「+ 새 태스크」(기본 상태)와 이슈 탭 보드 컬럼 「이슈 추가」(그 컬럼 상태 id, WP-464·WP-808)가 같이 연다.
  const [open, setOpen] = useState(false)
  const [createStatusId, setCreateStatusId] = useState<number | undefined>(undefined)
  // 프로젝트 key 가 바뀌면(같은 레이아웃이 다른 프로젝트로 재사용) 열린 대화상자·고른 컬럼 상태를 버린다 —
  // 렌더 중 이전 key 와 비교해 리셋(React 권장 "props 변경 시 state 조정" 패턴, effect 로 setState 하지 않는다).
  const [prevKey, setPrevKey] = useState(key)
  if (prevKey !== key) {
    setPrevKey(key)
    setOpen(false)
    setCreateStatusId(undefined)
  }
  // 탭 화면에 넘기는 값 — 개인·팀 모든 분기에 같이 씌운다. 개인 프로젝트에는 대화상자를 두지 않아 openCreate 를 부르는 곳이 없다.
  const context = useMemo<ProjectTabsValue | null>(
    () =>
      project.data
        ? {
            project: project.data,
            openCreate: (statusId?: number) => {
              setCreateStatusId(statusId)
              setOpen(true)
            },
          }
        : null,
    [project.data],
  )

  if (project.isLoading) return tabFallback
  if (project.error || !context) return <ProjectUnavailableState />

  // 개인 프로젝트 — 탭·탭 줄·기억 없음. 개요 탭은 개인 프로젝트에 없어 이슈 화면으로 보낸다.
  if (!team) {
    if (tab === 'overview') return <Navigate replace to={`/projects/${key}`} />
    let body: ReactNode
    if (tab === 'issues') body = <PersonalIssuesScreen projectKey={key} project={context.project} />
    else if (tab === null) body = <Outlet />
    else
      body = (
        <ProjectScreenFrame
          testId="project-personal-page"
          header={{
            icon: (
              <Button variant="ghost" size="icon" aria-label="프로젝트로 돌아가기" onClick={() => navigate(`/projects/${key}`)}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            ),
            title: PROJECT_TABS.find((t) => t.id === tab)?.label ?? context.project.name,
            meta: <span className="text-muted-foreground">{key}</span>,
            mobileActions: null,
          }}
        />
      )
    return <ProjectTabsContext.Provider value={context}>{body}</ProjectTabsContext.Provider>
  }

  // 조건 없이 /projects/:key 에 들어왔으면 기억한 탭(없으면 기본 탭 — 지금은 이슈라 그대로)으로 바꿔 보낸다 — 그동안 이슈 목록은 그리지 않는다.
  if (redirectTo) return <Navigate replace to={redirectTo} />

  // OPEN 프로젝트: 테넌트 전원 이슈 생성 허용. TEAM 은 멤버만(canCreateIssueIn).
  const canCreateIssue = canCreateIssueIn(context.project)
  const settingsPath = `/projects/${key}/settings`

  return (
    <ProjectTabsContext.Provider value={context}>
      <ProjectScreenFrame
        header={{
          title: context.project.name,
          meta: <span className="text-muted-foreground">{context.project.key}</span>,
          // 설정은 접는 보조 단추(auxiliaryActions, WP-1415)로 두지 않고 늘 보이는 액션으로 둔다 — 사이클·버전·타임라인이 탭으로
          // 옮겨 가 보조 단추가 설정 하나뿐이면, 접어도 ⋯ 대신 같은 링크 하나가 인라인으로 남아(U3-R7) 자리는 8px 남짓밖에
          // 줄지 않고 테두리 단추가 모바일식 파란 글자 링크로 모양만 바뀐다. 좁아지면 AI 칩이 동그라미로 줄어 자리를 낸다.
          actions: (
            <>
              <Button asChild variant="outline">
                <Link to={settingsPath}>설정</Link>
              </Button>
              {canCreateIssue && <Button onClick={() => context.openCreate()}>+ 새 태스크</Button>}
            </>
          ),
          // 모바일: 주 액션(새 태스크)만 ＋ 아이콘으로 인라인, 설정은 ⋯ 메뉴로(U1-2).
          mobilePrimaryAction: canCreateIssue && (
            <HeaderIconAction label="새 태스크" data-testid="mobile-new-issue" onClick={() => context.openCreate()}>
              <Plus />
            </HeaderIconAction>
          ),
          // 메뉴 항목은 링크 하나(포커스 한 번) — Link 안에 Button 을 중첩하지 않는다(U3-C3).
          mobileActions: <Link to={settingsPath}>설정</Link>,
        }}
        tabBar={<ProjectTabBar projectKey={key} active={tab} />}
      >
        <IssueCreateDialog projectKey={key} open={open} onOpenChange={setOpen} initialStatusId={createStatusId} />
      </ProjectScreenFrame>
    </ProjectTabsContext.Provider>
  )
}

/**
 * 프로젝트 화면 틀 하나 — Page(세로 flex 전체 높이) + 머리줄 + (팀만) 탭 줄 + 탭 본문(<Outlet/>, 모듈을 불러오는 동안 tabFallback).
 * 팀과 개인 화면(타임라인·사이클·버전)은 머리줄 props 와 탭 줄 유무만 다르다. 본문이 Page 안에 있어야 스크롤·타임라인 고정 높이가 산다.
 * children 은 본문 뒤에 붙는 것(팀의 새 태스크 대화상자).
 */
function ProjectScreenFrame({
  testId,
  header,
  tabBar,
  children,
}: {
  testId?: string
  header: ComponentProps<typeof Page.Header>
  tabBar?: ReactNode
  children?: ReactNode
}) {
  return (
    <Page data-testid={testId}>
      <Page.Header {...header} />
      {tabBar}
      <Suspense fallback={tabFallback}>
        <Outlet />
      </Suspense>
      {children}
    </Page>
  )
}

/**
 * 개인 프로젝트 이슈 화면 — 레이아웃이 개인 프로젝트의 이슈 길에서 바로 그린다(이슈 탭 ProjectDetailPage 는 팀 전용).
 * 필터·보기·그룹 기억(WP-1035)은 팀 이슈 탭과 같은 주소·같은 규칙이라 여기서도 되살린 뒤에 그린다. 탭 제목은 「이슈 · {프로젝트}」(WP-814).
 */
function PersonalIssuesScreen({ projectKey, project }: { projectKey: string; project: ProjectResponse }) {
  const restoring = useRememberedIssueQuery(projectKey, true)
  useDocumentTitle(['이슈', project.name])
  if (restoring) return tabFallback
  return <PersonalProjectDetail project={project} />
}
