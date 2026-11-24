import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { expect, it, vi } from 'vitest'

import { clearWorkflowDraftSessions } from '@/lib/workflowDraftSessions'
import { mkModel } from '@/test/kits/projects/workflowRunFixtures'
import { draftTime, nextDraftTime, renderWorkflow, workflowDetail, workflowProblem } from '@/test/kits/projects/workflowTestSupport'
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
  await userEvent.selectOptions(select, '42')
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
  renderWorkflow()
  let saved: { yaml?: string } = {}
  server.use(
    http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [] })),
    http.put('/api/v1/workflows/42/draft', async ({ request }) => {
      saved = (await request.json()) as { yaml?: string }
      return HttpResponse.json({ draftUpdatedAt: nextDraftTime, problems: [] })
    }),
  )
  fireEvent.click(await screen.findByRole('button', { name: '그래프' }))
  await userEvent.click(await screen.findByRole('button', { name: '+ 노드' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'AI 작업' }))
  const save = screen.getByRole('button', { name: '초안 저장' })
  await waitFor(() => expect(save).toBeEnabled())
  fireEvent.click(save)
  await waitFor(() => expect(saved.yaml).toContain('task_1:'))
})

it('workflowTab_viewerSeesReadOnlyGraph', async () => {
  renderWorkflow({ manager: false })
  fireEvent.click(await screen.findByRole('button', { name: '그래프' }))
  expect(await screen.findByText('살펴보기')).toBeVisible()
  expect(screen.queryByRole('button', { name: '+ 노드' })).not.toBeInTheDocument()
})

it('뷰 전환 단추는 디자인 시스템 ghost 토글 표시를 쓴다', async () => {
  renderWorkflow()
  const group = await screen.findByRole('group', { name: '워크플로우 표시 방식' })
  const graph = within(group).getByRole('button', { name: '그래프' })
  const yaml = within(group).getByRole('button', { name: 'YAML' })
  // 클래스를 공백 토큰으로 나눠 정확 일치 검사에 쓴다 — 부분문자열 검사는
  // border-transparent 에도 border 가 통과되는 등 오탐으로 공허해진다.
  const tokens = (el: HTMLElement) => el.className.split(/\s+/)

  // 처음에는 YAML 가 켜져 있다(모드 초기값 'yaml').
  expect(graph).toHaveAttribute('aria-pressed', 'false')
  expect(yaml).toHaveAttribute('aria-pressed', 'true')

  // 켜진 쪽: ghost 토글 채움(primary 테두리·배경·글자)과, 안 밀리기 위한 border 를 가진다.
  expect(yaml.className).toContain('bg-primary/10')
  expect(yaml.className).toContain('text-primary')
  expect(yaml.className).toContain('border-primary/50')
  expect(tokens(yaml)).toContain('border')

  // 꺼진 쪽: 토글 켜짐 클래스가 없고 테두리는 투명하다.
  expect(graph.className).not.toContain('bg-primary/10')
  expect(graph.className).not.toContain('text-primary')
  expect(tokens(graph)).toContain('border-transparent')

  await userEvent.click(graph)

  // 한쪽을 켜면 다른 쪽은 꺼진다.
  expect(graph).toHaveAttribute('aria-pressed', 'true')
  expect(yaml).toHaveAttribute('aria-pressed', 'false')
  expect(graph.className).toContain('bg-primary/10')
  expect(yaml.className).not.toContain('bg-primary/10')
  expect(tokens(yaml)).toContain('border-transparent')
})
