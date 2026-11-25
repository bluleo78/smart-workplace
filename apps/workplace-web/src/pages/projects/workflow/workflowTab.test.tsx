import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { expect, it, onTestFinished, vi } from 'vitest'

import { clearWorkflowDraftSessions } from '@/lib/workflowDraftSessions'
import { mkModel } from '@/test/kits/projects/workflowRunFixtures'
import { draftTime, nextDraftTime, renderWorkflow, workflowDetail, workflowProblem } from '@/test/kits/projects/workflowTestSupport'
import { gate } from '@/test/loadErrorRetry'
import { server } from '@/test/msw/server'

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

it('로그아웃 뒤 늦게 끝난 워크플로우 생성은 화면 캐시를 되살리지 않는다', async () => {
  const { getSummaries } = renderWorkflow({ empty: true })
  let releaseCreate!: () => void
  let signalCreateStarted!: () => void
  const createStarted = new Promise<void>((resolve) => { signalCreateStarted = resolve })
  server.use(http.post('/api/v1/projects/7/workflows', async () => {
    signalCreateStarted()
    await new Promise<void>((resolve) => { releaseCreate = resolve })
    return HttpResponse.json({ ...workflowDetail, id: 44, name: '늦은 생성' })
  }))
  await userEvent.click(await screen.findByRole('button', { name: '워크플로우 만들기' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText('이름'), { target: { value: '늦은 생성' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '만들기' }))
  await createStarted

  clearWorkflowDraftSessions()
  await act(async () => { releaseCreate() })

  await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: '만들기' })).toBeEnabled())
  expect(getSummaries).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('combobox', { name: '워크플로우 선택' })).not.toBeInTheDocument()
})

it('앱 안에서 다른 프로젝트 탭을 다녀와도 저장하지 않은 YAML을 복원한다', async () => {
  renderWorkflow()
  const changedYaml = 'name: 편집 중\nnodes:\n  review: {}\nnotes: 아직 저장 안 함'
  const editor = await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  fireEvent.change(editor, { target: { value: changedYaml } })

  await userEvent.click(screen.getByRole('link', { name: /^개요$/ }))
  expect(await screen.findByText('개요 본문')).toBeVisible()
  await userEvent.click(screen.getByRole('link', { name: '워크플로우로 돌아가기' }))

  expect(await screen.findByRole('textbox', { name: '워크플로우 YAML' })).toHaveValue(changedYaml)
})

it('sessionStorage 에 저장된 미저장 YAML도 탭 닫기 경고를 유지한다', async () => {
  renderWorkflow()
  fireEvent.change(await screen.findByRole('textbox', { name: '워크플로우 YAML' }), {
    target: { value: 'name: 탭 닫기 경고' },
  })
  const storageKey = Object.keys(window.sessionStorage).find((key) => key.startsWith('workflow-drafts:'))!
  await waitFor(() => expect(window.sessionStorage.getItem(storageKey)).not.toBeNull())

  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)

  expect(event.defaultPrevented).toBe(true)
})

it('탭을 떠난 사이 저장이 끝나면 세션 초안을 지우고 저장된 YAML을 보여 준다', async () => {
  renderWorkflow({ multiple: true })
  const changedYaml = 'name: 저장 완료\nnodes:\n  review: {}'
  let releaseSave!: () => void
  let signalSaveStarted!: () => void
  const saveStarted = new Promise<void>((resolve) => { signalSaveStarted = resolve })
  let latest = workflowDetail
  server.use(
    http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [] })),
    http.put('/api/v1/workflows/42/draft', async () => {
      signalSaveStarted()
      await new Promise<void>((resolve) => { releaseSave = resolve })
      latest = { ...workflowDetail, draftYaml: changedYaml, draftUpdatedAt: nextDraftTime }
      return HttpResponse.json({ draftUpdatedAt: nextDraftTime, problems: [] })
    }),
    http.get('/api/v1/workflows/42', () => HttpResponse.json(latest)),
  )
  fireEvent.change(await screen.findByRole('textbox', { name: '워크플로우 YAML' }), { target: { value: changedYaml } })
  const save = screen.getByRole('button', { name: '초안 저장' })
  await waitFor(() => expect(Object.keys(window.sessionStorage).some((key) => key.startsWith('workflow-drafts:'))).toBe(true))
  await waitFor(() => expect(save).toBeEnabled())
  fireEvent.click(save)
  await saveStarted
  const storageKey = Object.keys(window.sessionStorage).find((key) => key.startsWith('workflow-drafts:'))!

  await userEvent.click(screen.getByRole('link', { name: /^개요$/ }))
  expect(await screen.findByText('개요 본문')).toBeVisible()
  await userEvent.click(screen.getByRole('link', { name: '워크플로우로 돌아가기' }))
  await userEvent.selectOptions(await screen.findByRole('combobox', { name: '워크플로우 선택' }), '43')
  await userEvent.click(await screen.findByRole('tab', { name: 'YAML' }))
  const otherYaml = 'name: 별도 초안\nnodes:\n  check: {}'
  fireEvent.change(await screen.findByRole('textbox', { name: '워크플로우 YAML' }), { target: { value: otherYaml } })
  await waitFor(() => expect(window.sessionStorage.getItem(storageKey)).not.toBeNull())

  await act(async () => { releaseSave() })
  await waitFor(() => {
    const sessions = JSON.parse(window.sessionStorage.getItem(storageKey) ?? '[]') as Array<[number, unknown]>
    expect(sessions.map(([workflowId]) => workflowId)).toEqual([43])
  })
  expect(await screen.findByRole('textbox', { name: '워크플로우 YAML' })).toHaveValue(otherYaml)
})

it('탭을 떠난 사이 충돌이 나면 세션 초안에 충돌 상태를 보관한다', async () => {
  renderWorkflow()
  const changedYaml = 'name: 충돌 보존\nnodes:\n  review: {}'
  let releaseSave!: () => void
  let signalSaveStarted!: () => void
  const saveStarted = new Promise<void>((resolve) => { signalSaveStarted = resolve })
  server.use(
    http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [] })),
    http.put('/api/v1/workflows/42/draft', async () => {
      signalSaveStarted()
      await new Promise<void>((resolve) => { releaseSave = resolve })
      return HttpResponse.json({ errors: { code: 'WORKFLOW_DRAFT_CONFLICT' } }, { status: 409 })
    }),
  )
  fireEvent.change(await screen.findByRole('textbox', { name: '워크플로우 YAML' }), { target: { value: changedYaml } })
  const save = screen.getByRole('button', { name: '초안 저장' })
  await waitFor(() => expect(save).toBeEnabled())
  fireEvent.click(save)
  await saveStarted
  const storageKey = Object.keys(window.sessionStorage).find((key) => key.startsWith('workflow-drafts:'))!

  await userEvent.click(screen.getByRole('link', { name: /^개요$/ }))
  expect(await screen.findByText('개요 본문')).toBeVisible()
  await act(async () => { releaseSave() })
  await waitFor(() => {
    const sessions = JSON.parse(window.sessionStorage.getItem(storageKey) ?? '[]') as Array<[number, { edit: { yaml: string }; conflict: boolean }]>
    expect(sessions[0]?.[1]).toEqual(expect.objectContaining({ edit: expect.objectContaining({ yaml: changedYaml }), conflict: true }))
  })

  await userEvent.click(screen.getByRole('link', { name: '워크플로우로 돌아가기' }))
  expect(await screen.findByRole('button', { name: '최신 초안 불러오기' })).toBeVisible()
  expect(screen.getByRole('textbox', { name: '워크플로우 YAML' })).toHaveValue(changedYaml)
})

it('로그아웃 뒤 늦게 도착한 충돌 응답은 세션 초안을 되살리지 않는다', async () => {
  renderWorkflow()
  const changedYaml = 'name: 로그아웃\nnodes:\n  review: {}'
  let releaseSave!: () => void
  let signalSaveStarted!: () => void
  const saveStarted = new Promise<void>((resolve) => { signalSaveStarted = resolve })
  let signalSaveFinished!: () => void
  const saveFinished = new Promise<void>((resolve) => { signalSaveFinished = resolve })
  server.use(
    http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [] })),
    http.put('/api/v1/workflows/42/draft', async () => {
      signalSaveStarted()
      await new Promise<void>((resolve) => { releaseSave = resolve })
      signalSaveFinished()
      return HttpResponse.json({ errors: { code: 'WORKFLOW_DRAFT_CONFLICT' } }, { status: 409 })
    }),
  )
  fireEvent.change(await screen.findByRole('textbox', { name: '워크플로우 YAML' }), { target: { value: changedYaml } })
  fireEvent.click(screen.getByRole('button', { name: '초안 저장' }))
  await saveStarted
  const storageKey = Object.keys(window.sessionStorage).find((key) => key.startsWith('workflow-drafts:'))!
  clearWorkflowDraftSessions()
  await act(async () => { releaseSave() })
  await saveFinished
  await waitFor(() => expect(window.sessionStorage.getItem(storageKey)).toBeNull())
})

it('초안 저장 중 신원이 바뀌면 늦은 응답 뒤 게시하지 않는다', async () => {
  renderWorkflow()
  const changedYaml = 'name: 다른 신원\nnodes:\n  review: {}'
  let releaseSave!: () => void
  let signalSaveStarted!: () => void
  const saveStarted = new Promise<void>((resolve) => { signalSaveStarted = resolve })
  const publishRequest = vi.fn(() => HttpResponse.json({ versionNo: 3, runningRunsOnOlderVersions: 0 }))
  server.use(
    http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [] })),
    http.put('/api/v1/workflows/42/draft', async () => {
      signalSaveStarted()
      await new Promise<void>((resolve) => { releaseSave = resolve })
      return HttpResponse.json({ draftUpdatedAt: nextDraftTime, problems: [] })
    }),
    http.post('/api/v1/workflows/42/publish', publishRequest),
  )
  fireEvent.change(await screen.findByRole('textbox', { name: '워크플로우 YAML' }), { target: { value: changedYaml } })
  const publish = screen.getByRole('button', { name: '게시' })
  await waitFor(() => expect(publish).toBeEnabled())
  fireEvent.click(publish)
  const dialog = screen.getByRole('dialog')
  const confirm = within(dialog).getByRole('button', { name: '게시' })
  await waitFor(() => expect(confirm).toBeEnabled())
  fireEvent.click(confirm)
  await saveStarted

  clearWorkflowDraftSessions()
  await act(async () => { releaseSave() })
  await waitFor(() => expect(publishRequest).not.toHaveBeenCalled())
})

it('탭을 떠난 사이 최신 초안 불러오기가 끝나도 성공 상태를 반영한다', async () => {
  renderWorkflow()
  const changedYaml = 'name: 로컬 충돌\nnodes:\n  review: {}'
  let signalSaveStarted!: () => void
  const saveStarted = new Promise<void>((resolve) => { signalSaveStarted = resolve })
  server.use(
    http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [] })),
    http.put('/api/v1/workflows/42/draft', () => {
      signalSaveStarted()
      return HttpResponse.json({ errors: { code: 'WORKFLOW_DRAFT_CONFLICT' } }, { status: 409 })
    }),
  )
  fireEvent.change(await screen.findByRole('textbox', { name: '워크플로우 YAML' }), { target: { value: changedYaml } })
  fireEvent.click(screen.getByRole('button', { name: '초안 저장' }))
  await saveStarted
  const reload = await screen.findByRole('button', { name: '최신 초안 불러오기' })

  let releaseReload!: () => void
  let signalReloadStarted!: () => void
  const reloadStarted = new Promise<void>((resolve) => { signalReloadStarted = resolve })
  const latestYaml = 'name: 최신 서버 초안\nnodes:\n  review: {}'
  const storageKey = Object.keys(window.sessionStorage).find((key) => key.startsWith('workflow-drafts:'))!
  let reloadCalls = 0
  server.use(http.get('/api/v1/workflows/42', async () => {
    reloadCalls += 1
    if (reloadCalls === 1) {
      signalReloadStarted()
      await new Promise<void>((resolve) => { releaseReload = resolve })
    }
    return HttpResponse.json({ ...workflowDetail, draftYaml: latestYaml, draftUpdatedAt: nextDraftTime })
  }))
  fireEvent.click(reload)
  await reloadStarted
  await userEvent.click(screen.getByRole('link', { name: /^개요$/ }))
  expect(await screen.findByText('개요 본문')).toBeVisible()
  await act(async () => { releaseReload() })
  await userEvent.click(screen.getByRole('link', { name: '워크플로우로 돌아가기' }))

  expect(await screen.findByRole('textbox', { name: '워크플로우 YAML' })).toHaveValue(latestYaml)
  await waitFor(() => expect(window.sessionStorage.getItem(storageKey)).toBeNull())
})

it('프로젝트 재조회가 일시 실패하면 기존 세션 초안을 보존한다', async () => {
  const { refreshProject } = renderWorkflow()
  fireEvent.change(await screen.findByRole('textbox', { name: '워크플로우 YAML' }), { target: { value: 'name: 보존할 초안' } })
  const storageKey = Object.keys(window.sessionStorage).find((key) => key.startsWith('workflow-drafts:'))!
  await waitFor(() => expect(window.sessionStorage.getItem(storageKey)).not.toBeNull())
  server.use(http.get('/api/v1/projects/WP', () => HttpResponse.json({ message: '잠시 후 다시 시도' }, { status: 500 })))

  await act(refreshProject)

  await waitFor(() => expect(window.sessionStorage.getItem(storageKey)).not.toBeNull())
})

it('워크플로우가 목록에서 사라지면 그 정의의 세션 초안을 지운다', async () => {
  const { setSummaries, refreshSummaries } = renderWorkflow()
  fireEvent.change(await screen.findByRole('textbox', { name: '워크플로우 YAML' }), { target: { value: 'name: 삭제 대상' } })
  const storageKey = Object.keys(window.sessionStorage).find((key) => key.startsWith('workflow-drafts:'))!
  await waitFor(() => expect(window.sessionStorage.getItem(storageKey)).not.toBeNull())

  await userEvent.click(screen.getByRole('link', { name: /^개요$/ }))
  expect(await screen.findByText('개요 본문')).toBeVisible()
  setSummaries([])
  await act(refreshSummaries)
  await waitFor(() => expect(window.sessionStorage.getItem(storageKey)).toBeNull())
})

it('관리 권한이 사라지면 그 세션의 편집 초안을 지운다', async () => {
  const { setManager, refreshProject } = renderWorkflow()
  fireEvent.change(await screen.findByRole('textbox', { name: '워크플로우 YAML' }), { target: { value: 'name: 권한 회수' } })
  const storageKey = Object.keys(window.sessionStorage).find((key) => key.startsWith('workflow-drafts:'))!
  await waitFor(() => expect(window.sessionStorage.getItem(storageKey)).not.toBeNull())

  await userEvent.click(screen.getByRole('link', { name: /^개요$/ }))
  expect(await screen.findByText('개요 본문')).toBeVisible()
  setManager(false)
  await act(refreshProject)
  await waitFor(() => expect(window.sessionStorage.getItem(storageKey)).toBeNull())
})

it('publishDialog_mentionsRunningRuns', async () => {
  renderWorkflow()
  let publishedBody: unknown
  let published = false
  server.use(
    // 초안이 게시본과 같으면 게시가 꺼지므로(WP-2043) 게시본 원문을 초안과 다르게 준다.
    http.get('/api/v1/workflows/42/versions/2', () => HttpResponse.json({ versionNo: 2, sourceYaml: 'name: 게시본과 다른 원문', model: { nodes: [] } })),
    http.get('/api/v1/workflows/42', () => HttpResponse.json({
      ...workflowDetail, activeVersion: { ...workflowDetail.activeVersion, no: published ? 3 : 2 },
    })),
    http.post('/api/v1/workflows/42/publish', async ({ request }) => {
      publishedBody = await request.json()
      published = true
      return HttpResponse.json({ versionNo: 3, runningRunsOnOlderVersions: 4 })
    }),
  )
  // 게시본 원문을 불러와 변경이 있다고 확인되면 게시가 열린다.
  const openPublish = await screen.findByRole('button', { name: '게시' })
  await waitFor(() => expect(openPublish).toBeEnabled())
  fireEvent.click(openPublish)
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
  await userEvent.click(screen.getByRole('tab', { name: '그래프' }))
  const publish = screen.getByRole('button', { name: '게시' })
  await waitFor(() => expect(publish).toBeEnabled())
  fireEvent.click(publish)
  const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: '게시' })
  await waitFor(() => expect(confirm).toBeEnabled())
  fireEvent.click(confirm)

  // 그래프의 경고 줄에도 같은 문구가 잠깐 뜨므로, 편집기로 돌아간(대화상자가 닫힌) 뒤의 진단 목록을 본다.
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(await screen.findByText('노드를 확인하세요.')).toBeVisible()
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
  await userEvent.click(screen.getByRole('tab', { name: '그래프' }))
  expect(await screen.findByText('살펴보기')).toBeVisible()
  await userEvent.click(screen.getByRole('tab', { name: '게시 이력' }))
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
    // 초안이 게시본과 같으면 게시가 꺼지므로(WP-2043) 게시본 원문을 초안과 다르게 준다.
    http.get('/api/v1/workflows/42/versions/2', () => HttpResponse.json({ versionNo: 2, sourceYaml: 'name: 게시본과 다른 원문', model: { nodes: [] } })),
    http.get('/api/v1/workflows/42', () => HttpResponse.json(latest)),
    http.post('/api/v1/workflows/42/publish', async ({ request }) => {
      publishBody = await request.json()
      return HttpResponse.json({ errors: { code: 'WORKFLOW_DRAFT_CONFLICT' } }, { status: 409 })
    }),
  )
  // 게시본 원문을 불러와 변경이 있다고 확인되면 게시가 열린다.
  const openPublish = await screen.findByRole('button', { name: '게시' })
  await waitFor(() => expect(openPublish).toBeEnabled())
  fireEvent.click(openPublish)
  const dialog = screen.getByRole('dialog')
  expect(await within(dialog).findByText('진행 중 실행 4은 시작한 버전으로 계속')).toBeVisible()
  latest = { ...workflowDetail, draftYaml: 'name: 다른 곳에서 수정', draftUpdatedAt: nextDraftTime, enabled: true }
  expect(screen.getByText('사용 안 함')).toBeVisible()
  await act(refreshWorkflow)
  await waitFor(() => expect(screen.queryByText('사용 안 함')).not.toBeInTheDocument())
  fireEvent.click(within(dialog).getByRole('button', { name: '게시' }))
  expect(await screen.findByRole('button', { name: '최신 초안 불러오기' })).toBeVisible()
  expect(publishBody).toEqual({ expectedDraftUpdatedAt: draftTime })
})

it('publishDialog_disablesUntilRunCountLoaded_andRetriesFailure', async () => {
  renderWorkflow()
  let attempts = 0
  server.use(
    // 초안이 게시본과 같으면 게시가 꺼지므로(WP-2043) 게시본 원문을 초안과 다르게 준다.
    http.get('/api/v1/workflows/42/versions/2', () => HttpResponse.json({ versionNo: 2, sourceYaml: 'name: 게시본과 다른 원문', model: { nodes: [] } })),
    http.get('/api/v1/workflows/42/versions', async () => {
      if (++attempts === 1) {
        await delay(250)
        return new HttpResponse(null, { status: 503 })
      }
      return HttpResponse.json([{ versionNo: 2, createdAt: draftTime, createdBy: null, activeRuns: 7 }])
    }),
  )
  // 게시본 원문을 불러와 변경이 있다고 확인되면 게시가 열린다.
  const openPublish = await screen.findByRole('button', { name: '게시' })
  await waitFor(() => expect(openPublish).toBeEnabled())
  fireEvent.click(openPublish)
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
  expect(screen.getByRole('button', { name: '게시' })).toBeDisabled()
})

it('publish_disabledWhenNoUnpostedChanges_withReason', async () => {
  renderWorkflow()
  const changed = 'name: 변경 있음'
  server.use(http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [] })))
  const yaml = await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  const original = (yaml as HTMLTextAreaElement).value
  expect(await screen.findByText('게시 안 한 변경 0')).toBeVisible()
  const publish = screen.getByRole('button', { name: '게시' })
  expect(publish).toBeDisabled()
  expect(publish).toHaveAccessibleDescription('바꾼 내용이 없어 게시할 것이 없습니다.')
  expect(publish).not.toHaveAttribute('title')
  // 꺼진 단추는 툴팁이 안 뜨므로 이유가 눈에 보이는 글자로 있어야 한다.
  expect(await screen.findByText('바꾼 내용이 없어 게시할 것이 없습니다.')).toBeVisible()

  fireEvent.change(yaml, { target: { value: changed } })
  await waitFor(() => expect(screen.getByRole('button', { name: '게시' })).toBeEnabled())
  expect(screen.getByRole('button', { name: '게시' })).not.toHaveAttribute('title')
  expect(screen.getByRole('button', { name: '게시' })).toHaveAccessibleDescription('')
  expect(screen.queryByText('바꾼 내용이 없어 게시할 것이 없습니다.')).not.toBeInTheDocument()

  fireEvent.change(yaml, { target: { value: original } })
  expect(await screen.findByText('게시 안 한 변경 0')).toBeVisible()
  expect(screen.getByRole('button', { name: '게시' })).toBeDisabled()
})

it('publish_enabledForFirstPublish_whenNoActiveVersion', async () => {
  renderWorkflow({ multiple: true, search: '?workflow=43&view=yaml' })
  server.use(http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [] })))
  await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  await waitFor(() => expect(screen.getByRole('button', { name: '게시' })).toBeEnabled())
  expect(screen.getByRole('button', { name: '게시' })).not.toHaveAttribute('title')
})

it('publish_notBlockedWhenPublishedSourceFails', async () => {
  renderWorkflow()
  server.use(
    http.get('/api/v1/workflows/42/versions/2', () => new HttpResponse(null, { status: 500 })),
    http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [] })),
  )
  expect(await screen.findByText('게시 안 한 변경 수를 불러오지 못했습니다.')).toBeVisible()
  await waitFor(() => expect(screen.getByRole('button', { name: '게시' })).toBeEnabled())
})

it('tab_viewParamOpensRunsPanel', async () => {
  server.use(
    http.get('/api/v1/workflows/42/runs', () => HttpResponse.json({ items: [], nextCursor: null })),
    http.get('/api/v1/projects/WP/members', () => HttpResponse.json([])),
  )
  renderWorkflow({ search: '?view=runs' })
  expect(await screen.findByRole('tab', { name: /^실행/, selected: true })).toBeVisible()
  expect(await screen.findByText('아직 실행이 없습니다')).toBeVisible()
  // 목록 보기에서도 versions 의 activeRuns 합계(3+1)를 보인다.
  expect(await screen.findByText('진행 중인 실행 4개')).toBeVisible()
})

// WP-2044 탭이 versions 의 옛 버전 activeRuns(v1 1개)를 모아 보기 안내로 넘긴다 — 배선 확인.
it('tab_graphView_passesOlderVersionRunsToNotice', async () => {
  server.use(
    http.get('/api/v1/workflows/42/run-counts', () => HttpResponse.json({ counts: { review: 3 } })),
    http.get('/api/v1/projects/WP/members', () => HttpResponse.json([])),
  )
  renderWorkflow({ search: '?view=runs&runsView=graph' })
  const notice = await screen.findByRole('note')
  expect(notice).toHaveTextContent('옛 버전 실행 1개는 이 그래프에 표시하지 않습니다 (v1 1개) — 게시 버전 v2의 실행만 단계에 셉니다.')
})

// 이슈 카드의 「실행 보기 ↗」가 싣는 ?workflow= 로 그 정의의 목록이 열린다(없으면 첫 정의), 정의를 바꾸면 run·모아 보기가 지워진다.
it('tab_workflowParamOpensThatDefinition_changeClearsRun', async () => {
  server.use(
    http.get('/api/v1/workflows/:id/runs', () => HttpResponse.json({ items: [], nextCursor: null })),
    http.get('/api/v1/workflow-runs/7', () => HttpResponse.json({ code: 'NOT_FOUND', message: 'x' }, { status: 404 })),
    http.get('/api/v1/projects/WP/members', () => HttpResponse.json([])),
  )
  renderWorkflow({ multiple: true, search: '?view=runs&workflow=43&run=7' })
  const select = await screen.findByRole('combobox', { name: '워크플로우 선택' })
  await waitFor(() => expect(select).toHaveValue('43'))
  expect(await screen.findByText('실행을 찾을 수 없습니다')).toBeVisible()
  // 정의 상세가 도착하면 머리가 SelectedWorkflow 안에서 다시 그려지므로 선택 상자를 다시 찾는다.
  await userEvent.selectOptions(screen.getByRole('combobox', { name: '워크플로우 선택' }), '42')
  await waitFor(() => expect(screen.getByRole('combobox', { name: '워크플로우 선택' })).toHaveValue('42'))
  // 정의를 바꾸면 하위 보기(view)도 지워져 편집기가 열린다 — 실행 탭이 남지 않는다.
  expect(await screen.findByRole('tab', { name: /^실행/, selected: false })).toBeVisible()
  expect(screen.queryByText('실행을 고르면 여기에 상세가 보입니다.')).not.toBeInTheDocument()
  expect(screen.queryByText('실행을 찾을 수 없습니다')).not.toBeInTheDocument()
})

it('tab_unknownWorkflowParam_fallsBackToFirst', async () => {
  server.use(
    http.get('/api/v1/workflows/42/runs', () => HttpResponse.json({ items: [], nextCursor: null })),
    http.get('/api/v1/projects/WP/members', () => HttpResponse.json([])),
  )
  renderWorkflow({ multiple: true, search: '?view=runs&workflow=999' })
  expect(await screen.findByRole('combobox', { name: '워크플로우 선택' })).toHaveValue('42')
})

it('tab_runsPanel_versionsFailure_offersRetry', async () => {
  renderWorkflow({ search: '?view=runs' })
  // renderWorkflow 가 깐 핸들러보다 뒤에 둬야 이긴다.
  server.use(
    http.get('/api/v1/workflows/42/versions', () => new HttpResponse(null, { status: 500 })),
    http.get('/api/v1/workflows/42/runs', () => HttpResponse.json({ items: [], nextCursor: null })),
    http.get('/api/v1/projects/WP/members', () => HttpResponse.json([])),
  )
  expect(await screen.findByText(/실행 수를 불러오지 못했습니다/)).toBeVisible()
  expect(screen.getByRole('button', { name: '다시 불러오기' })).toBeVisible()
})

// 실행 상세에서 조치(실행 취소)를 마치면 버전 요약(activeRuns)을 다시 읽어 「진행 중인 실행 N개」가 바뀐다.
it('tab_runsPanel_recover_refreshesActiveRunCount', async () => {
  let versionsCalls = 0
  const run = {
    runId: 7, workflowId: 42, versionNo: 2, issueId: 70, issueNumber: 70, issueKey: 'WP-70', title: '로그인 개선', status: 'SUSPENDED', revision: 3, currentNode: 'b',
    startedBy: null, startedAt: '2026-11-20T00:00:00Z', endedAt: null, context: {},
  }
  renderWorkflow({ search: '?view=runs&run=7' })
  // renderWorkflow 가 깐 핸들러보다 뒤에 둬야 이긴다.
  server.use(
    http.get('/api/v1/workflows/42/versions', () => {
      versionsCalls += 1
      return HttpResponse.json([{ versionNo: 2, createdAt: draftTime, createdBy: null, activeRuns: versionsCalls === 1 ? 3 : 2 }])
    }),
    http.get('/api/v1/workflows/42/runs', () => HttpResponse.json({ items: [], nextCursor: null })),
    http.get('/api/v1/workflow-runs/7', () => HttpResponse.json({ run, nodeRuns: [], events: [], model: mkModel() })),
    http.get('/api/v1/issues/70/workflow', () => HttpResponse.json({ runId: 7, status: 'SUSPENDED', revision: 3, workflowId: 42, versionNo: 2, currentNode: null, outcomes: [], path: [], remainingNodeKeys: [], context: {} })),
    http.post('/api/v1/issues/70/workflow/recover', () => HttpResponse.json({ runId: 7, status: 'CANCELLED', revision: 4, workflowId: 42, versionNo: 2, currentNode: null, outcomes: [], path: [], remainingNodeKeys: [], context: {} })),
    http.get('/api/v1/projects/WP/members', () => HttpResponse.json([])),
  )
  expect(await screen.findByText('진행 중인 실행 3개')).toBeVisible()
  await userEvent.click(await screen.findByRole('button', { name: '조치 고르기' }))
  await userEvent.click(screen.getByRole('radio', { name: '실행 취소' }))
  await userEvent.click(screen.getByRole('button', { name: '확인' }))
  expect(await screen.findByText('진행 중인 실행 2개')).toBeVisible()
})

it('workflowTab_managerGraphEditsDraft', async () => {
  renderWorkflow({ search: '?workflow=42' })
  let saved: { yaml?: string } = {}
  server.use(
    http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [] })),
    http.put('/api/v1/workflows/42/draft', async ({ request }) => {
      saved = (await request.json()) as { yaml?: string }
      return HttpResponse.json({ draftUpdatedAt: nextDraftTime, problems: [] })
    }),
  )
  await userEvent.click(await screen.findByRole('button', { name: '+ 노드' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'AI 작업' }))
  const save = screen.getByRole('button', { name: '초안 저장' })
  await waitFor(() => expect(save).toBeEnabled())
  fireEvent.click(save)
  await waitFor(() => expect(saved.yaml).toContain('task_1:'))
})

/** 문서의 제목 순서에서 앞 제목보다 두 단계 이상 깊어진 [앞, 뒤] 쌍 — 비어 있어야 제목 단계 건너뜀이 없다(WP-2054, WCAG 1.3.1) */
function headingSkips() {
  const levels = screen.getAllByRole('heading').map((h) => Number(h.tagName[1]))
  return levels.flatMap((l, i) => (i > 0 && l > levels[i - 1] + 1 ? [[levels[i - 1], l]] : []))
}

it('tab_graphNodePanel_noHeadingLevelSkip', async () => {
  renderWorkflow({ search: '?workflow=42' })
  server.use(http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [] })))
  // 노드를 더하면 그 노드가 선택되어 노드 패널이 열린다 — 패널 절 제목이 h2 다음 h4 로 건너뛰지 않아야 한다(WP-2054)
  await userEvent.click(await screen.findByRole('button', { name: '+ 노드' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'AI 작업' }))
  await screen.findByRole('button', { name: '노드 지우기' })
  expect(headingSkips()).toEqual([])
  expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0)
})

it('workflowTab_viewerSeesReadOnlyGraph', async () => {
  renderWorkflow({ manager: false, search: '?workflow=42' })
  expect(await screen.findByText('살펴보기')).toBeVisible()
  expect(screen.queryByRole('button', { name: '+ 노드' })).not.toBeInTheDocument()
})

it('publish_disabledWhileCheckingChangeCount_withoutReason', async () => {
  renderWorkflow()
  // 게시본 원문 요청이 끝나지 않는 동안에는 변경 수를 모르므로 게시를 막되 사유 글자는 띄우지 않는다.
  // 응답은 이 테스트가 끝날 때 푼다 — 끝나지 않는 Promise 로 두면 핸들러가 테스트 뒤까지 열려 남는다
  const hold = gate()
  onTestFinished(() => hold.release())
  server.use(
    http.get('/api/v1/workflows/42/versions/2', async () => {
      await hold.promise
      return HttpResponse.json({})
    }),
    http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [] })),
  )
  await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  expect(await screen.findByText('게시 안 한 변경 수 확인 중')).toBeVisible()
  const publish = screen.getByRole('button', { name: '게시' })
  expect(publish).toBeDisabled()
  expect(publish).not.toHaveAttribute('aria-describedby')
  expect(screen.queryByText('바꾼 내용이 없어 게시할 것이 없습니다.')).not.toBeInTheDocument()
})

it('publish_noReasonForFirstPublish_withEmptyDraft', async () => {
  renderWorkflow({ multiple: true, search: '?workflow=43&view=yaml' })
  server.use(http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [] })))
  const yaml = await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  fireEvent.change(yaml, { target: { value: '' } })
  await waitFor(() => expect((yaml as HTMLTextAreaElement).value).toBe(''))
  // 첫 게시는 비교할 게시본이 없어 빈 초안이어도 「변경 없음」 안내를 띄우지 않는다(검증 때문에 꺼질 수는 있다).
  expect(screen.queryByText('바꾼 내용이 없어 게시할 것이 없습니다.')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '게시' })).not.toHaveAttribute('aria-describedby')
})

it('tab_panelsStartWithH2_noHeadingLevelSkip', async () => {
  renderWorkflow()
  server.use(
    http.get('/api/v1/workflows/42/runs', () => HttpResponse.json({ items: [], nextCursor: null })),
    http.get('/api/v1/projects/WP/members', () => HttpResponse.json([])),
  )
  // 탭 패널 제목 — 페이지 h1 다음 h3 로 건너뛰지 않게 패널마다 h2 가 먼저 온다(WP-2054)
  await screen.findByRole('tab', { name: '그래프' })
  for (const name of ['그래프', 'YAML', '실행', '게시 이력']) {
    await userEvent.click(screen.getByRole('tab', { name: new RegExp('^' + name) }))
    const first = within(screen.getByRole('tabpanel')).getAllByRole('heading')[0]
    expect(first.tagName).toBe('H2')
    expect(first).toHaveTextContent(name)
    expect(headingSkips()).toEqual([])
  }
  await userEvent.click(screen.getByRole('tab', { name: 'YAML' }))
  expect(await screen.findByRole('heading', { level: 3, name: '검증 결과' })).toBeInTheDocument()
  expect(headingSkips()).toEqual([])
})

it('view_defaultsToGraph_andSwitchWritesUrl', async () => {
  const { search } = renderWorkflow({ search: '?workflow=42' })
  expect(await screen.findByRole('tab', { name: '그래프', selected: true })).toBeVisible()
  server.use(
    http.get('/api/v1/workflows/42/runs', () => HttpResponse.json({ items: [], nextCursor: null })),
    http.get('/api/v1/projects/WP/members', () => HttpResponse.json([])),
  )
  await userEvent.click(screen.getByRole('tab', { name: 'YAML' }))
  expect(search()).toContain('view=yaml')
  expect(await screen.findByRole('textbox', { name: '워크플로우 YAML' })).toBeVisible()
  await userEvent.click(screen.getByRole('tab', { name: '게시 이력' }))
  expect(search()).toContain('view=versions')
  await userEvent.click(screen.getByRole('tab', { name: /^실행/ }))
  expect(search()).toContain('view=runs')
})

it('legacyEditorView_opensGraph', async () => {
  renderWorkflow({ search: '?view=editor' })
  expect(await screen.findByRole('tab', { name: '그래프', selected: true })).toBeVisible()
})

it('header_tabsAreOneLevel', async () => {
  renderWorkflow()
  const list = await screen.findByRole('tablist', { name: '워크플로우 보기' })
  const tabs = within(list).getAllByRole('tab')
  expect(tabs).toHaveLength(4)
  expect(tabs.map((tab) => tab.textContent?.replace(/ \d+$/, ''))).toEqual(['그래프', 'YAML', '실행', '게시 이력'])
  expect(screen.queryByRole('group', { name: '워크플로우 표시 방식' })).not.toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: '편집' })).not.toBeInTheDocument()
})

it('tab_pickWorkflow_focusLandsOnNewSelectEvenWhileDetailLoads', async () => {
  // 고른 정의의 상세가 늦게 와도(임시 머리의 선택 상자가 먼저 그려져도) 초점은 새 SelectedWorkflow 의 선택 상자에 남는다
  renderWorkflow({ multiple: true, search: '?workflow=42' })
  server.use(http.get('/api/v1/workflows/43', async () => {
    await delay(150)
    return HttpResponse.json({ ...workflowDetail, id: 43, name: '두번째', activeVersionNo: null })
  }), http.get('/api/v1/workflows/43/versions', () => HttpResponse.json([])), http.get('/api/v1/workflows/43/versions/2', () => HttpResponse.json({ versionNo: 2, sourceYaml: 'name: x', model: { nodes: [] } })))
  await waitFor(() => expect(screen.getByRole('tab', { name: '그래프' })).toBeVisible())
  const first = screen.getByRole('combobox', { name: '워크플로우 선택' })
  first.focus()
  await userEvent.selectOptions(first, '43')
  await waitFor(() => expect(screen.getByRole('combobox', { name: '워크플로우 선택' })).toHaveValue('43'))
  await waitFor(() => expect(screen.getByRole('tab', { name: '그래프' })).toBeVisible())
  await waitFor(() => expect(screen.getByRole('combobox', { name: '워크플로우 선택' })).toHaveFocus())
})

it('problemsBadge_hiddenAtZero_showsCounts', async () => {
  // 검사 결과가 없으면 배지가 없다
  renderWorkflow({ search: '?workflow=42' })
  expect(await screen.findByRole('tab', { name: '그래프' })).toBeVisible()
  expect(screen.queryByRole('button', { name: /검사 결과/ })).not.toBeInTheDocument()
})

it('problemsBadge_showsCounts_andOpensYamlDiagnostics', async () => {
  renderWorkflow({ search: '?workflow=42' })
  server.use(http.get('/api/v1/workflows/42', () => HttpResponse.json({
    ...workflowDetail,
    draftProblems: [workflowProblem, { ...workflowProblem, severity: 'WARNING', code: 'W', message: '주의' }],
  })))
  await userEvent.click(await screen.findByRole('button', { name: '검사 결과 오류 1 · 경고 1' }))
  await userEvent.click(screen.getByRole('button', { name: 'YAML 오류 확인' }))
  const yaml = await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  await waitFor(() => expect(yaml).toHaveFocus())
})

it('readOnlyHeader_hasNoSaveButtons', async () => {
  renderWorkflow({ manager: false, search: '?workflow=42' })
  const list = await screen.findByRole('tablist', { name: '워크플로우 보기' })
  expect(within(list).getAllByRole('tab')).toHaveLength(4)
  for (const name of ['초안 저장', '게시', '되돌리기']) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  }
  expect(screen.queryByRole('button', { name: /검사 결과/ })).not.toBeInTheDocument()
  expect(screen.getByText('게시 버전 2')).toBeVisible()
})

it('draftBadge_shownForManagerWithDraft', async () => {
  const { setSummaries } = renderWorkflow()
  setSummaries([{ id: 42, name: '작업 정리', enabled: false, activeVersionNo: 2, draftChanged: true }])
  expect(await screen.findByText('초안 있음')).toBeVisible()
})

// 검사 배지가 지난 결과·서버 초안 진단으로 낡은 목록을 보이거나 그 목록으로 고치지 않게 한다(WP-2090 반려 고침)
const askWarning = { ...workflowProblem, severity: 'WARNING' as const, code: 'ASK_PATH_MISSING', message: '질문 경로 없음', nodeKey: 'review' }

it('검사 중에는 지난 결과로 질문 경로를 더할 수 없다', async () => {
  renderWorkflow({ search: '?workflow=42' })
  const hold = gate()
  let calls = 0
  server.use(http.post('/api/v1/workflows/validate', async () => {
    calls += 1
    if (calls > 1) await hold.promise
    return HttpResponse.json({ problems: [askWarning] })
  }))
  await userEvent.click(await screen.findByRole('tab', { name: 'YAML' }))
  const box = await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  fireEvent.change(box, { target: { value: 'name: 첫 고침\nnodes:\n  review: {}' } })
  expect(await screen.findByRole('button', { name: '검사 결과 경고 1' })).toBeVisible()
  await waitFor(() => expect(screen.queryAllByText('검증 중…')).toHaveLength(0))
  fireEvent.change(box, { target: { value: 'name: 둘째 고침\nnodes:\n  review: {}' } })
  expect((await screen.findAllByText('검증 중…')).length).toBeGreaterThan(0)
  await userEvent.click(screen.getByRole('button', { name: '검사 결과 경고 1 (지난 결과)' }))
  expect(screen.getByRole('button', { name: '질문 경로 추가' })).toBeDisabled()
  hold.release()
})

it('검사 실패·다시 확인 뒤에도 배지는 마지막 성공 결과다', async () => {
  renderWorkflow({ search: '?workflow=42' })
  const hold = gate()
  let calls = 0
  server.use(
    http.get('/api/v1/workflows/42', () => HttpResponse.json({ ...workflowDetail, draftProblems: [workflowProblem, { ...workflowProblem }] })),
    http.post('/api/v1/workflows/validate', async () => {
      calls += 1
      if (calls === 1) return HttpResponse.json({ problems: [askWarning] })
      if (calls === 2) return HttpResponse.json({ message: 'x' }, { status: 500 })
      await hold.promise
      return HttpResponse.json({ problems: [askWarning] })
    }),
  )
  await userEvent.click(await screen.findByRole('tab', { name: 'YAML' }))
  const box = await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  fireEvent.change(box, { target: { value: 'name: 하나\nnodes:\n  review: {}' } })
  expect(await screen.findByRole('button', { name: '검사 결과 경고 1' })).toBeVisible()
  fireEvent.change(box, { target: { value: 'name: 둘\nnodes:\n  review: {}' } })
  await userEvent.click((await screen.findAllByRole('button', { name: '다시 확인' }))[0])
  expect((await screen.findAllByText('검증 중…')).length).toBeGreaterThan(0)
  expect(screen.getByRole('button', { name: '검사 결과 경고 1 (지난 결과)' })).toBeVisible()
  expect(screen.queryByRole('button', { name: /오류 2/ })).not.toBeInTheDocument()
  hold.release()
  await waitFor(() => expect(screen.queryAllByText('검증 중…')).toHaveLength(0))
})

it('이 세션 성공 결과가 없으면 검사 중 배지는 서버 초안 진단을 지난 결과로 둔다', async () => {
  renderWorkflow({ search: '?workflow=42' })
  const hold = gate()
  server.use(
    http.get('/api/v1/workflows/42', () => HttpResponse.json({ ...workflowDetail, draftProblems: [workflowProblem, { ...workflowProblem }] })),
    http.post('/api/v1/workflows/validate', async () => {
      await hold.promise
      return HttpResponse.json({ problems: [] })
    }),
  )
  expect(await screen.findByRole('button', { name: '검사 결과 오류 2' })).toBeVisible()
  await userEvent.click(await screen.findByRole('tab', { name: 'YAML' }))
  fireEvent.change(await screen.findByRole('textbox', { name: '워크플로우 YAML' }), { target: { value: 'name: 고침\nnodes:\n  review: {}' } })
  expect((await screen.findAllByText('검증 중…')).length).toBeGreaterThan(0)
  // 첫 검사가 끝나기 전에도 서버 초안의 오류가 사라졌다 돌아오지 않는다(지난 결과 표시)
  expect(screen.getByRole('button', { name: '검사 결과 오류 2 (지난 결과)' })).toBeVisible()
  hold.release()
  await waitFor(() => expect(screen.queryAllByText('검증 중…')).toHaveLength(0))
})

it('되돌린 뒤 다시 편집하면 검사 중 배지가 버린 편집의 결과를 보이지 않는다', async () => {
  renderWorkflow({ search: '?workflow=42&view=yaml' })
  server.use(http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [workflowProblem] })))
  const box = await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  fireEvent.change(box, { target: { value: 'name: 하나\nnodes:\n  review: {}' } })
  expect(await screen.findByRole('button', { name: '검사 결과 오류 1' })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: '되돌리기' }))
  const hold = gate()
  server.use(http.post('/api/v1/workflows/validate', async () => {
    await hold.promise
    return HttpResponse.json({ problems: [] })
  }))
  fireEvent.change(await screen.findByRole('textbox', { name: '워크플로우 YAML' }), { target: { value: 'name: 둘\nnodes:\n  review: {}' } })
  expect((await screen.findAllByText('검증 중…')).length).toBeGreaterThan(0)
  expect(screen.queryByRole('button', { name: /오류 1/ })).not.toBeInTheDocument()
  hold.release()
  await waitFor(() => expect(screen.queryAllByText('검증 중…')).toHaveLength(0))
})

// 선택 지적 ③⑤⑥ — 검증 안내 중복·그래프 보기 스크린리더 알림·선택 상자 초점 복귀 범위(WP-2090 반려 고침)
it('YAML 보기에서 검증 중 안내는 하나만 알린다', async () => {
  renderWorkflow({ search: '?workflow=42&view=yaml' })
  const hold = gate()
  server.use(http.post('/api/v1/workflows/validate', async () => {
    await hold.promise
    return HttpResponse.json({ problems: [] })
  }))
  const box = await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  fireEvent.change(box, { target: { value: 'name: 고침\nnodes:\n  review: {}' } })
  await screen.findAllByText('검증 중…')
  expect(screen.getAllByRole('status').filter((el) => el.textContent?.includes('검증 중'))).toHaveLength(1)
  hold.release()
})

it('그래프 보기는 새 오류 수를 숨긴 상태 영역으로 알린다', async () => {
  renderWorkflow({ search: '?workflow=42&view=graph' })
  server.use(http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [workflowProblem] })))
  await userEvent.click(await screen.findByRole('tab', { name: 'YAML' }))
  fireEvent.change(await screen.findByRole('textbox', { name: '워크플로우 YAML' }), { target: { value: 'name: 고침\nnodes:\n  review: {}' } })
  await userEvent.click(screen.getByRole('tab', { name: '그래프' }))
  const live = await waitFor(() => {
    const found = screen.getAllByRole('status').find((el) => el.textContent === '오류 1')
    expect(found).toBeDefined()
    return found!
  })
  expect(live).toHaveClass('sr-only')
})

it('상세 불러오기 실패 뒤 워크플로우를 만들면 드롭다운으로 초점을 옮기지 않는다', async () => {
  renderWorkflow({ multiple: true, search: '?workflow=42' })
  server.use(
    http.get('/api/v1/workflows/43', () => HttpResponse.json({ message: 'x' }, { status: 500 })),
    http.get('/api/v1/projects/7/workflows', () => HttpResponse.json([
      { id: 42, name: '작업 정리', enabled: false, activeVersionNo: 2, draftChanged: false },
      { id: 43, name: '다른 워크플로우', enabled: false, activeVersionNo: null, draftChanged: false },
      { id: 44, name: '새 정의', enabled: false, activeVersionNo: null, draftChanged: true },
    ])),
    http.post('/api/v1/projects/7/workflows', () => HttpResponse.json({ ...workflowDetail, id: 44, name: '새 정의' })),
    http.get('/api/v1/workflows/44', () => HttpResponse.json({ ...workflowDetail, id: 44, name: '새 정의' })),
    http.get('/api/v1/workflows/44/versions', () => HttpResponse.json([{ versionNo: 2, createdAt: draftTime, createdBy: null, activeRuns: 0 }])),
    http.get('/api/v1/workflows/44/versions/2', () => HttpResponse.json({ versionNo: 2, sourceYaml: 'name: 새 정의', model: { nodes: [] } })),
  )
  const select = await screen.findByRole('combobox', { name: '워크플로우 선택' })
  fireEvent.change(select, { target: { value: '43' } })
  // 43 상세가 실제로 실패한 뒤(재시도 끝)에 만든다 — 로딩·재시도 중 요청이 테스트 끝에 남아 워커가 죽지 않게
  await screen.findByRole('button', { name: '다시 불러오기' }, { timeout: 15000 })
  await userEvent.click(await screen.findByRole('button', { name: '워크플로우 만들기' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText('이름'), { target: { value: '새 정의' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '만들기' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByRole('combobox', { name: '워크플로우 선택' })).toHaveValue('44'))
  expect(document.activeElement).not.toBe(screen.getByRole('combobox', { name: '워크플로우 선택' }))
  // 만들기 뒤 새 정의 상세 재조회가 그려질 때까지 기다린다 — 열린 요청을 남기지 않는다
  await screen.findByRole('tab', { name: 'YAML' })
})

it('상세 불러오기 실패 뒤 다시 불러와 선택 화면이 그려져도 드롭다운으로 초점을 옮기지 않는다', async () => {
  renderWorkflow({ multiple: true, search: '?workflow=42' })
  server.use(http.get('/api/v1/workflows/43', () => HttpResponse.json({ message: 'x' }, { status: 500 })))
  fireEvent.change(await screen.findByRole('combobox', { name: '워크플로우 선택' }), { target: { value: '43' } })
  const retry = await screen.findByRole('button', { name: '다시 불러오기' }, { timeout: 15000 })
  server.use(http.get('/api/v1/workflows/43', () => HttpResponse.json({ ...workflowDetail, id: 43, name: '다른 워크플로우', activeVersion: null, draftYaml: 'name: 다른 초안' })))
  await userEvent.click(retry)
  await screen.findByRole('tab', { name: 'YAML' })
  expect(document.activeElement).not.toBe(screen.getByRole('combobox', { name: '워크플로우 선택' }))
})
