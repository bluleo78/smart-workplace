// 사이드바 프로젝트 네비 진입로 — 「전체 보기」 링크와 「+」 생성 대화상자 — 화면 테스트(WP-980, WP-1002 에서 사이드바만 띄우게 바꿈).
// 링크 이동(주소)과 대화상자 열림은 브라우저 없이 판정되므로 e2e/pages/projects/project-nav.spec.ts 에서 옮겼다(그 spec 은 지웠다).
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { IssueSidebar } from '@/components/issue/IssueSidebar'
import { renderScreen } from '@/test/renderScreen'

import { createProject } from '../../../e2e/factories/project.factory'

/** 작업 모듈 사이드바만 띄운다 — 사이드바가 부르는 조회는 전체 프로젝트·고정한 뷰다. */
const renderSidebar = (path: string) =>
  renderScreen(<IssueSidebar />, { path, handlers: [projectList, http.get('/api/v1/me/pinned-views', () => HttpResponse.json([]))] })

const projectList = http.get('/api/v1/projects', () =>
  HttpResponse.json({ content: [createProject({ key: 'EX', name: '예제', type: 'TEAM' })], page: 0, size: 20, totalElements: 1, totalPages: 1 }),
)

describe('사이드바 프로젝트 네비', () => {
  test('「전체 보기」를 누르면 /projects 로 간다', async () => {
    const { user, location } = renderSidebar('/me/tasks')
    await user.click(await screen.findByTestId('sidebar-all-projects'))
    await waitFor(() => expect(location()).toBe('/projects'))
  })

  test('「프로젝트」 섹션 「+」를 누르면 생성 대화상자가 열린다', async () => {
    const { user } = renderSidebar('/projects')
    await user.click(await screen.findByTestId('sidebar-create-project'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
