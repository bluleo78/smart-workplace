// 이슈 상세 화면 테스트 도우미(WP-1002) — 이슈 상세 화면(IssueDetailPage)만 App·앱 셸 없이 renderScreen 으로 띄운다.
// 상세는 속성 레일·본문·활동·채팅 드로워가 한 화면에서 이어져(저장 뒤 재조회가 칸에 다시 내려온다) 화면 단위로 띄운다.
import { screen } from '@testing-library/react'
import type { RequestHandler } from 'msw'

import type { AuthContextValue } from '@/hooks/auth-context-value'
import IssueDetailPage from '@/pages/projects/IssueDetailPage'

import { detailNumberOf, issueDetailHandlers, type IssueDetailOptions } from './issueDetailStubs'
import { renderRouteScreen, SCREEN_LOAD_TIMEOUT, type ScreenOptions } from './routeScreen'

/** 이슈 상세 화면(/projects/:key/issues/:number)만 띄운다. */
export function renderIssueDetailScreen(path: string, options: ScreenOptions = {}) {
  return renderRouteScreen('/projects/:key/issues/:number', <IssueDetailPage />, path, options)
}

/**
 * 이슈 상세를 열고 제목이 뜰 때까지 기다린다 — issueDetailStubs 의 openIssueDetail 과 같은 구성(핸들러는 issueDetailStubs).
 * handlers 는 issueDetailHandlers 기본보다 우선한다.
 */
export async function openIssueDetailScreen(
  options: IssueDetailOptions & { handlers?: RequestHandler[]; path?: string; auth?: Partial<AuthContextValue> } = {},
) {
  const { handlers = [], path, auth, ...rest } = options
  const key = rest.key ?? 'WP'
  const view = renderIssueDetailScreen(path ?? `/projects/${key}/issues/${detailNumberOf(rest)}`, {
    handlers: [...handlers, ...issueDetailHandlers(rest)],
    auth,
  })
  await screen.findByTestId('issue-title-heading', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  return view
}
