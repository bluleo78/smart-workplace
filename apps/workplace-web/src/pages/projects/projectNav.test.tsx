// 사이드바 프로젝트 네비 진입로 — 「전체 보기」 링크와 「+」 생성 대화상자 — 페이지 테스트(WP-980).
// 링크 이동(주소)과 대화상자 열림은 브라우저 없이 판정되므로 e2e/pages/projects/project-nav.spec.ts 에서 옮겼다(그 spec 은 지웠다).
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { createProject } from '../../../e2e/factories/project.factory'

const projectList = http.get('/api/v1/projects', () =>
  HttpResponse.json({ content: [createProject({ key: 'EX', name: '예제', type: 'TEAM' })], page: 0, size: 20, totalElements: 1, totalPages: 1 }),
)

describe('사이드바 프로젝트 네비', () => {
  test('「전체 보기」를 누르면 /projects 로 간다', async () => {
    const { user, location } = renderPage('/me/tasks', { handlers: [projectList] })
    await user.click(await screen.findByTestId('sidebar-all-projects', {}, { timeout: PAGE_LOAD_TIMEOUT }))
    await waitFor(() => expect(location()).toBe('/projects'))
  })

  test('「프로젝트」 섹션 「+」를 누르면 생성 대화상자가 열린다', async () => {
    const { user } = renderPage('/projects', { handlers: [projectList] })
    await user.click(await screen.findByTestId('sidebar-create-project', {}, { timeout: PAGE_LOAD_TIMEOUT }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
