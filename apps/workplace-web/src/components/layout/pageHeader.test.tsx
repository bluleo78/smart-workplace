// 컨텐츠 헤더(PageHeader) 표준 — 화면 컴포넌트 테스트(WP-971, WP-966).
// 프로젝트 목록·이슈 상세의 헤더 바 구성(높이 클래스·h1 제목·액션 위치, 이슈 상세는 브레드크럼만 두고 제목은 본문으로)은
// 브라우저 없이 판정되므로 e2e/pages/page-header.spec.ts 에서 옮겼다. 넓은 화면에서 제목·액션이 헤더 좌우 끝에 붙는지(@layout)는 E2E 에 남는다.
// 헤더를 가진 페이지 컴포넌트만 renderScreen 으로 띄운다(앱 셸 불필요).
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import IssueDetailPage from '@/pages/projects/IssueDetailPage'
import ProjectListPage from '@/pages/projects/ProjectListPage'
import { issueDetailHandlers } from '@/test/kits/projects/issueDetailStubs'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { createProject } from '../../../e2e/factories/project.factory'

// 프로젝트 목록 — 헤더 바(h-14)에 제목이 h1 heading 으로(refs #121) 있고 「+ 새 프로젝트」 액션이 헤더 안에 있다.
test('프로젝트 목록: 헤더 바에 제목 "프로젝트"(h1) + 새 프로젝트 액션', async () => {
  renderScreen(<ProjectListPage />, {
    path: '/projects',
    handlers: [
      http.get('/api/v1/projects', () =>
        HttpResponse.json({ content: [createProject({ key: 'EX', name: '예제' })], page: 0, size: 20, totalElements: 1, totalPages: 1 }),
      ),
    ],
  })
  const header = await screen.findByTestId('page-header')
  expect(header).toHaveClass('h-14')
  expect(within(header).getByRole('heading', { level: 1, name: '프로젝트' })).toBeInTheDocument()
  expect(within(header).getByRole('button', { name: '+ 새 프로젝트' })).toBeInTheDocument()
})

// 이슈 상세 — 헤더엔 브레드크럼(키)과 watch·삭제 액션만, 제목은 본문 상단 heading 으로(Jira 스타일).
test('이슈 상세: 헤더엔 브레드크럼(키)+watch/삭제 액션, 본문엔 제목이 렌더된다', async () => {
  renderScreen(
    // 이슈 상세는 AI 패널 모드(useAssistant)를 읽어 배치를 정하므로 AI 공급자로 감싼다.
    <AIAssistantProvider hotkeysEnabled={false}>
      <Routes>
        <Route path="/projects/:key/issues/:number" element={<IssueDetailPage />} />
      </Routes>
    </AIAssistantProvider>,
    {
      path: '/projects/WP/issues/1',
      // 상세가 섹션마다 부르는 프로젝트 메타(라벨·유형·상태·사이클 등)와 이슈 채팅 스레드는 앱 셸 기본 응답(shellHandlers)으로 채운다.
      handlers: [...issueDetailHandlers({
        project: createProject(),
        detail: createIssueDetail({
          summary: createIssue({ id: 1, number: 1, projectKey: 'WP', title: '헤더 검증 이슈' }),
          body: '본문',
          comments: [],
          history: [],
        }),
      }), ...shellHandlers],
    },
  )
  expect(await screen.findByTestId('issue-title-heading')).toHaveTextContent('헤더 검증 이슈')
  const header = screen.getByTestId('page-header')
  expect(header).toHaveClass('h-14')
  expect(header).toHaveTextContent('WP-1')
  expect(header).not.toHaveTextContent('헤더 검증 이슈')
  const watch = within(header).getByTestId('watch-toggle')
  expect(watch).toHaveAttribute('aria-pressed', 'false')
  expect(within(header).getByTestId('issue-delete')).toBeInTheDocument()
})
