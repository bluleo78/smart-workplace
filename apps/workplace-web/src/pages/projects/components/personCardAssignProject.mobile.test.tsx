// 프로젝트 없이 연 「일 맡기기」의 휴대폰 시트(WP-1768) — 뷰포트가 파일당 하나라 데스크톱(personCardAssignProject.test.tsx)과 나눈다.
// 시트도 맨 위에 「프로젝트」 칸을 두고, 바꿔도 제목이 남으며, 만들기는 고른 프로젝트로 요청한다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import { renderScreen } from '@/test/renderScreen'
import { mockViewport } from '@/test/viewport'

import { createIssue } from '../../../../e2e/factories/issue.factory'
import { systemTypes } from '../../../../e2e/factories/issueType.factory'
import { createProject } from '../../../../e2e/factories/project.factory'
import { IssueCreateDialog } from './IssueCreateDialog'

mockViewport()

const PROJECTS = [
  createProject({ id: 1, key: 'ME', name: '내 일', type: 'PERSONAL', isDefault: true }),
  createProject({ id: 3, key: 'ALPHA', name: '알파 팀' }),
  createProject({ id: 4, key: 'BETA', name: '베타 팀' }),
]

test('휴대폰 시트도 맨 위 「프로젝트」 칸에서 고르고, 바꿔도 제목이 남으며 고른 프로젝트로 만든다', async () => {
  const created: string[] = []
  const { user } = renderScreen(<IssueCreateDialog projectKey="" selectProject open onOpenChange={() => {}} initialAgentId={9} />, {
    handlers: [
      http.get('/api/v1/projects', () =>
        HttpResponse.json({ content: PROJECTS, page: 0, size: 100, totalElements: PROJECTS.length, totalPages: 1 }),
      ),
      http.get('/api/v1/projects/:key/types', () => HttpResponse.json(systemTypes())),
      http.get('/api/v1/projects/:key/recurrence-agents', () => HttpResponse.json([])),
      http.get('/api/v1/projects/:key/:sub', () => HttpResponse.json([])),
      http.get('/api/v1/projects/:key', ({ params }) => HttpResponse.json(PROJECTS.find((p) => p.key === params.key))),
      http.post('/api/v1/projects/:key/issues', ({ params }) => {
        created.push(String(params.key))
        return HttpResponse.json(createIssue({ id: 1, number: 1, projectKey: String(params.key) }), { status: 201 })
      }),
    ],
  })
  const sheet = await screen.findByTestId('issue-create-sheet', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  const field = within(sheet).getByRole('combobox', { name: '프로젝트' })
  expect(field).toHaveTextContent('알파 팀')
  await user.type(within(sheet).getByTestId('issue-create-title'), '모바일 일')
  await user.click(field)
  await user.click(await screen.findByRole('option', { name: '베타 팀' }))
  await waitFor(() => expect(within(sheet).getByRole('combobox', { name: '프로젝트' })).toHaveTextContent('베타 팀'))
  expect(within(sheet).getByTestId('issue-create-title')).toHaveValue('모바일 일')
  await user.click(within(sheet).getByTestId('issue-create-submit'))
  await waitFor(() => expect(created).toEqual(['BETA']))
})

test('휴대폰 시트도 본문에 이슈 이미지를 넣으면 프로젝트 칸이 잠기고 이유를 보인다', async () => {
  renderScreen(<IssueCreateDialog projectKey="" selectProject open onOpenChange={() => {}} />, {
    handlers: [
      http.get('/api/v1/projects', () =>
        HttpResponse.json({ content: PROJECTS, page: 0, size: 100, totalElements: PROJECTS.length, totalPages: 1 }),
      ),
      http.get('/api/v1/projects/:key/types', () => HttpResponse.json(systemTypes())),
      http.get('/api/v1/projects/:key/issue-images/:id', () => new HttpResponse(new Blob(['x'], { type: 'image/png' }))),
      http.get('/api/v1/projects/:key/:sub', () => HttpResponse.json([])),
      http.get('/api/v1/projects/:key', ({ params }) => HttpResponse.json(PROJECTS.find((p) => p.key === params.key))),
    ],
  })
  const sheet = await screen.findByTestId('issue-create-sheet', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  expect(within(sheet).getByRole('combobox', { name: '프로젝트' })).toBeEnabled()
  const clipboardData = {
    getData: (type: string) => (type === 'text/plain' ? '![a.png](/api/v1/projects/ALPHA/issue-images/5)' : ''),
    types: ['text/plain'],
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
  }
  act(() => {
    fireEvent.paste(within(sheet).getByTestId('issue-create-body'), { clipboardData })
  })
  await waitFor(() => expect(within(sheet).getByRole('combobox', { name: '프로젝트' })).toBeDisabled())
  expect(within(sheet).getByText('이미지를 넣은 뒤에는 프로젝트를 바꿀 수 없습니다')).toBeInTheDocument()
})
