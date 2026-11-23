import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { expect, it, vi } from 'vitest'

import { server } from '@/test/msw/server'

import { draftTime, nextDraftTime, renderWorkflow, workflowDetail, workflowProblem } from './workflowTestSupport'

// 프로젝트 탭과 본문의 권한이 같아야 직접 주소로 들어와도 쓰기 단추가 생기지 않는다.
vi.mock('../components/IssueCreateDialog', () => ({ IssueCreateDialog: () => null }))

it('tab_visibleForManager', async () => {
  const { getSummaries } = renderWorkflow({ empty: true, enterTab: false })
  const tab = await screen.findByRole('link', { name: '워크플로우' })
  expect(tab).toHaveAttribute('href', '/projects/WP/workflow')
  fireEvent.click(tab)
  expect(await screen.findByRole('button', { name: '워크플로우 만들기' })).toBeVisible()
  expect(getSummaries).toHaveBeenCalledTimes(1)
})

it('앱 안에서 다른 프로젝트 탭을 다녀와도 저장하지 않은 YAML을 복원한다', async () => {
  renderWorkflow()
  const changedYaml = 'name: 편집 중\nnodes:\n  review: {}\nnotes: 아직 저장 안 함'
  fireEvent.change(await screen.findByRole('textbox', { name: '워크플로우 YAML' }), { target: { value: changedYaml } })

  await userEvent.click(screen.getByRole('link', { name: /^개요$/ }))
  expect(await screen.findByText('개요 본문')).toBeVisible()
  await userEvent.click(screen.getByRole('link', { name: '워크플로우로 돌아가기' }))

  expect(await screen.findByRole('textbox', { name: '워크플로우 YAML' })).toHaveValue(changedYaml)
})

it('publishDialog_mentionsRunningRuns', async () => {
  renderWorkflow()
  let publishedBody: unknown
  let published = false
  server.use(
    http.get('/api/v1/workflows/42', () => HttpResponse.json({
      ...workflowDetail, activeVersion: { ...workflowDetail.activeVersion, no: published ? 3 : 2 },
    })),
    http.post('/api/v1/workflows/42/publish', async ({ request }) => {
      publishedBody = await request.json()
      published = true
      return HttpResponse.json({ versionNo: 3, runningRunsOnOlderVersions: 4 })
    }),
  )
  fireEvent.click(await screen.findByRole('button', { name: '게시' }))
  const dialog = screen.getByRole('dialog')
  expect(await within(dialog).findByText('진행 중 실행 4은 시작한 버전으로 계속')).toBeVisible()
  fireEvent.click(within(dialog).getByRole('button', { name: '게시' }))
  expect(await screen.findByText('게시 버전 3')).toBeVisible()
  expect(publishedBody).toEqual({ expectedDraftUpdatedAt: draftTime })
  expect(screen.getByText('사용 안 함')).toBeVisible()
})

it('게시 전 초안 저장에서 오류를 받으면 편집기로 돌아가 게시가 중단된 이유를 보여 준다', async () => {
  renderWorkflow()
  const changedYaml = 'name: 수정\nnodes:\n  review: {}'
  const publishRequest = vi.fn(() => HttpResponse.json({ versionNo: 3, runningRunsOnOlderVersions: 4 }))
  server.use(
    http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [] })),
    http.put('/api/v1/workflows/42/draft', () => HttpResponse.json({
      draftUpdatedAt: nextDraftTime, problems: [workflowProblem],
    })),
    http.post('/api/v1/workflows/42/publish', publishRequest),
  )
  const yaml = await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  fireEvent.change(yaml, { target: { value: changedYaml } })
  fireEvent.click(screen.getByRole('button', { name: '그래프' }))
  const publish = screen.getByRole('button', { name: '게시' })
  await waitFor(() => expect(publish).toBeEnabled())
  fireEvent.click(publish)
  const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: '게시' })
  await waitFor(() => expect(confirm).toBeEnabled())
  fireEvent.click(confirm)

  expect(await screen.findByText('노드를 확인하세요.')).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '워크플로우 YAML' })).toHaveValue(changedYaml)
  expect(screen.getByRole('alert')).toHaveTextContent(/오류.*게시/)
  expect(publish).toBeDisabled()
  expect(publishRequest).not.toHaveBeenCalled()
})

it('nonManager_readOnly', async () => {
  renderWorkflow({ manager: false })
  expect(await screen.findByRole('link', { name: '워크플로우' })).toBeVisible()
  const yaml = await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  expect(yaml).toHaveAttribute('readonly')
  expect(yaml).toHaveValue('name: 정리\nnodes:\n  review: {}')
  fireEvent.click(screen.getByRole('button', { name: '그래프' }))
  expect(await screen.findByText('살펴보기')).toBeVisible()
  await userEvent.click(screen.getByRole('tab', { name: '버전' }))
  expect(await screen.findByText('실행 3개')).toBeVisible()
  for (const name of ['워크플로우 만들기', '초안 저장', '되돌리기', '게시', '초안으로 복원']) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  }
})

it('개인 프로젝트 소유자는 등록된 워크플로우가 없어도 만들 수 있다', async () => {
  const { getSummaries } = renderWorkflow({ personal: true, empty: true })
  expect(await screen.findByRole('button', { name: '워크플로우 만들기' })).toBeVisible()
  expect(screen.getByRole('heading', { name: '워크플로우' })).toBeVisible()
  expect(getSummaries).toHaveBeenCalledTimes(1)
})

it('읽을 수 있는 개인 프로젝트에서 소유자가 아닌 조회자는 게시 YAML을 읽는다', async () => {
  renderWorkflow({ personal: true, manager: false })
  expect(await screen.findByRole('textbox', { name: '워크플로우 YAML' })).toHaveAttribute('readonly')
  expect(screen.queryByRole('button', { name: '워크플로우 만들기' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '게시' })).not.toBeInTheDocument()
})

it('publish_confirmationUsesOpenedDraftTimestamp', async () => {
  const { refreshWorkflow } = renderWorkflow()
  let latest = workflowDetail
  let publishBody: unknown
  server.use(
    http.get('/api/v1/workflows/42', () => HttpResponse.json(latest)),
    http.post('/api/v1/workflows/42/publish', async ({ request }) => {
      publishBody = await request.json()
      return HttpResponse.json({ errors: { code: 'WORKFLOW_DRAFT_CONFLICT' } }, { status: 409 })
    }),
  )
  fireEvent.click(await screen.findByRole('button', { name: '게시' }))
  const dialog = screen.getByRole('dialog')
  expect(await within(dialog).findByText('진행 중 실행 4은 시작한 버전으로 계속')).toBeVisible()
  latest = { ...workflowDetail, draftYaml: 'name: 다른 곳에서 수정', draftUpdatedAt: nextDraftTime, enabled: true }
  await act(refreshWorkflow)
  await screen.findByText('사용 중')
  fireEvent.click(within(dialog).getByRole('button', { name: '게시' }))
  expect(await screen.findByRole('button', { name: '최신 초안 불러오기' })).toBeVisible()
  expect(publishBody).toEqual({ expectedDraftUpdatedAt: draftTime })
})

it('publishDialog_disablesUntilRunCountLoaded_andRetriesFailure', async () => {
  renderWorkflow()
  let attempts = 0
  server.use(http.get('/api/v1/workflows/42/versions', async () => {
    if (++attempts === 1) {
      await delay(250)
      return new HttpResponse(null, { status: 503 })
    }
    return HttpResponse.json([{ versionNo: 2, createdAt: draftTime, createdBy: null, activeRuns: 7 }])
  }))
  fireEvent.click(await screen.findByRole('button', { name: '게시' }))
  const dialog = within(screen.getByRole('dialog'))
  const confirm = dialog.getByRole('button', { name: '게시' })
  expect(confirm).toBeDisabled()
  const retry = await dialog.findByRole('button', { name: '실행 수 다시 불러오기' })
  expect(confirm).toBeDisabled()
  fireEvent.click(retry)
  expect(await dialog.findByText('진행 중 실행 7은 시작한 버전으로 계속')).toBeVisible()
  expect(confirm).toBeEnabled()
})

it('unpostedChangeCount_survivesDraftSave_andResetsAfterPublish', async () => {
  renderWorkflow()
  const base = 'name: 이전\nnotes: 고정\nowner: 이전\nroles: {}\nlast: 이전'
  const changed = 'name: 수정\nnotes: 고정\nowner: 수정\nroles: {}\nlast: 수정'
  let latest = { ...workflowDetail, draftYaml: base }
  server.use(
    http.get('/api/v1/workflows/42', () => HttpResponse.json(latest)),
    http.get('/api/v1/workflows/42/versions/2', () => HttpResponse.json({ versionNo: 2, sourceYaml: base, model: { nodes: [] } })),
    http.get('/api/v1/workflows/42/versions/3', () => HttpResponse.json({ versionNo: 3, sourceYaml: changed, model: { nodes: [] } })),
    http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [] })),
    http.put('/api/v1/workflows/42/draft', () => {
      latest = { ...latest, draftYaml: changed, draftUpdatedAt: nextDraftTime }
      return HttpResponse.json({ draftUpdatedAt: nextDraftTime, problems: [] })
    }),
    http.post('/api/v1/workflows/42/publish', () => {
      latest = { ...latest, activeVersion: { ...latest.activeVersion, no: 3 } }
      return HttpResponse.json({ versionNo: 3, runningRunsOnOlderVersions: 0 })
    }),
  )
  const yaml = await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  expect(await screen.findByText('게시 안 한 변경 0')).toBeVisible()
  fireEvent.change(yaml, { target: { value: changed } })
  expect(screen.getByText('게시 안 한 변경 3')).toBeVisible()
  const save = screen.getByRole('button', { name: '초안 저장' })
  fireEvent.click(save)
  const publish = screen.getByRole('button', { name: '게시' })
  await waitFor(() => expect(publish).toBeEnabled())
  expect(save).toBeDisabled()
  expect(screen.getByText('게시 안 한 변경 3')).toBeVisible()
  fireEvent.click(publish)
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '게시' }))
  expect(await screen.findByText('게시 버전 3')).toBeVisible()
  expect(await screen.findByText('게시 안 한 변경 0')).toBeVisible()
})
