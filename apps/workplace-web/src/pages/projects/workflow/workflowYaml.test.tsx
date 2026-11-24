import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { expect, it, vi } from 'vitest'

import { hasUnsavedInput } from '@/lib/unsavedInput'
import { draftTime, nextDraftTime, renderWorkflow, workflowDetail, workflowProblem } from '@/test/kits/projects/workflowTestSupport'
import { server } from '@/test/msw/server'

vi.mock('../components/IssueCreateDialog', () => ({ IssueCreateDialog: () => null }))

it('yamlEdit_debouncedValidate_showsProblemsWithLines', async () => {
  renderWorkflow()
  const requests: unknown[] = []
  server.use(http.post('/api/v1/workflows/validate', async ({ request }) => {
    requests.push(await request.json())
    return HttpResponse.json({ problems: [workflowProblem] })
  }))
  const yaml = await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  fireEvent.change(yaml, { target: { value: 'name: 바꿈' } })
  fireEvent.change(yaml, { target: { value: 'name: 바꿈\nnodes:\n  review:' } })
  expect(requests).toEqual([])
  expect(await screen.findByRole('button', { name: /3행 3열.*노드를 확인하세요/ })).toBeVisible()
  expect(requests).toEqual([{ projectId: 7, yaml: 'name: 바꿈\nnodes:\n  review:' }])
  expect(screen.getByTestId('workflow-yaml-line-3')).toHaveClass('decoration-wavy')
})

it('clickProblem_movesCursorToLine', async () => {
  renderWorkflow()
  server.use(http.get('/api/v1/workflows/42', () => HttpResponse.json({
    ...workflowDetail, draftProblems: [workflowProblem],
  })))
  const yaml = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: '워크플로우 YAML' })
  fireEvent.click(screen.getByRole('button', { name: /3행 3열/ }))
  expect(yaml).toHaveFocus()
  expect(yaml.selectionStart).toBe('name: 정리\nnodes:\n  '.length)
  expect(yaml.selectionEnd).toBe(yaml.selectionStart)
})

it('publish_disabledWhenErrors_enabledWithWarnings', async () => {
  renderWorkflow()
  server.use(
    http.get('/api/v1/workflows/42', () => HttpResponse.json({
      ...workflowDetail, draftProblems: [workflowProblem],
    })),
    http.post('/api/v1/workflows/validate', () => HttpResponse.json({
      problems: [{ ...workflowProblem, severity: 'WARNING' }],
    })),
  )
  const yaml = await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  expect(screen.getByRole('button', { name: '게시' })).toBeDisabled()
  fireEvent.change(yaml, { target: { value: 'name: 고침' } })
  expect(await screen.findByText('경고')).toBeVisible()
  // 게시본 원문(versions/2) 조회가 끝나 변경 수를 안 뒤에 켜지므로 기다려 단언한다
  await waitFor(() => expect(screen.getByRole('button', { name: '게시' })).toBeEnabled())
})

it.each(['검증 응답', '저장된 초안'])('그래프에서 %s의 오류를 확인하고 YAML 진단으로 돌아갈 수 있다', async (source) => {
  renderWorkflow()
  server.use(
    http.get('/api/v1/workflows/42', () => HttpResponse.json({
      ...workflowDetail, draftProblems: source === '저장된 초안' ? [workflowProblem] : [],
    })),
    http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [workflowProblem] })),
  )
  const yaml = await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  if (source === '검증 응답') {
    fireEvent.change(yaml, { target: { value: 'name: 검증할 초안\nnodes:\n  review:' } })
    expect(screen.getByText('검증 중…')).toBeVisible()
  }
  fireEvent.click(screen.getByRole('button', { name: '그래프' }))

  expect(await screen.findByText('YAML에 오류가 있어 게시할 수 없습니다.')).toBeVisible()
  expect(screen.getByRole('button', { name: '게시' })).toBeDisabled()
  // 단추는 그래프 아래 경고 줄에만 있다(상태 줄은 안내 문장만) — 하나여야 한다.
  screen.getByRole('button', { name: 'YAML 오류 확인' }).focus()
  await userEvent.keyboard('{Enter}')
  expect(await screen.findByRole('textbox', { name: '워크플로우 YAML' })).toHaveFocus()
  expect(screen.getByRole('button', { name: /3행 3열.*노드를 확인하세요/ })).toBeVisible()
})

it('draftConflict_showsReloadPrompt', async () => {
  renderWorkflow()
  let latest = workflowDetail
  let saveBody: unknown
  server.use(
    http.get('/api/v1/workflows/42', () => HttpResponse.json(latest)),
    http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [] })),
    http.put('/api/v1/workflows/42/draft', async ({ request }) => {
      saveBody = await request.json()
      latest = { ...workflowDetail, draftYaml: 'name: 서버에서 수정', draftUpdatedAt: nextDraftTime }
      return HttpResponse.json({ errors: { code: 'WORKFLOW_DRAFT_CONFLICT' } }, { status: 409 })
    }),
  )
  const yaml = await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  fireEvent.change(yaml, { target: { value: 'name: 내가 수정' } })
  fireEvent.click(screen.getByRole('button', { name: '초안 저장' }))
  const reload = await screen.findByRole('button', { name: '최신 초안 불러오기' })
  expect(saveBody).toEqual({ yaml: 'name: 내가 수정', expectedDraftUpdatedAt: draftTime })
  expect(yaml).toHaveValue('name: 내가 수정')
  fireEvent.click(reload)
  await waitFor(() => expect(yaml).toHaveValue('name: 서버에서 수정'))
})

it('검증 중 그래프로 바꿔도 실패를 확인하고 다시 검증한 뒤 게시할 수 있다', async () => {
  renderWorkflow()
  const updatedYaml = 'name: 게시할 수정'
  let validationCalls = 0
  let savedBody: unknown
  let publishedBody: unknown
  server.use(
    http.post('/api/v1/workflows/validate', () => {
      if (++validationCalls === 1) return new HttpResponse(null, { status: 503 })
      return HttpResponse.json({ problems: [] })
    }),
    http.put('/api/v1/workflows/42/draft', async ({ request }) => {
      savedBody = await request.json()
      return HttpResponse.json({ draftUpdatedAt: nextDraftTime, problems: [] })
    }),
    http.post('/api/v1/workflows/42/publish', async ({ request }) => {
      publishedBody = await request.json()
      return HttpResponse.json({ versionNo: 3, runningRunsOnOlderVersions: 4 })
    }),
    http.get('/api/v1/workflows/42/versions/3', () => HttpResponse.json({
      versionNo: 3, sourceYaml: updatedYaml,
      model: { nodes: [{ key: 'review', type: 'human_task', name: '게시한 단계' }] },
    })),
  )
  const yaml = await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  fireEvent.change(yaml, { target: { value: updatedYaml } })
  expect(screen.getByText('검증 중…')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '그래프' }))
  expect(screen.getByText('검증 중…')).toBeVisible()
  expect(await screen.findByText('검증 결과를 불러오지 못했습니다.')).toBeVisible()
  const retry = await screen.findByRole('button', { name: '다시 확인' })
  const publish = screen.getByRole('button', { name: '게시' })
  expect(screen.queryByText('오류')).not.toBeInTheDocument()
  expect(publish).toBeDisabled()
  fireEvent.click(retry)
  expect(publish).toBeDisabled()
  await waitFor(() => expect(publish).toBeEnabled())
  expect(screen.queryByRole('button', { name: '다시 확인' })).not.toBeInTheDocument()
  fireEvent.click(publish)
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '게시' }))
  expect(await screen.findByText('게시 버전 3')).toBeVisible()
  // 관리자의 그래프는 게시본이 아니라 초안 편집기다(WP-1995) — 게시 뒤에도 편집기가 그대로 보인다.
  expect(screen.getByRole('button', { name: '+ 노드' })).toBeVisible()
  expect(savedBody).toEqual({ yaml: updatedYaml, expectedDraftUpdatedAt: draftTime })
  expect(publishedBody).toEqual({ expectedDraftUpdatedAt: nextDraftTime })
})

it('워크플로우를 바꿨다가 돌아와도 저장 충돌이 난 YAML과 복구 안내가 남는다', async () => {
  renderWorkflow({ multiple: true })
  server.use(
    http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [] })),
    http.put('/api/v1/workflows/42/draft', () => HttpResponse.json({ errors: { code: 'WORKFLOW_DRAFT_CONFLICT' } }, { status: 409 })),
  )
  const yaml = await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  fireEvent.change(yaml, { target: { value: 'name: 보존할 수정' } })
  fireEvent.click(screen.getByRole('button', { name: '초안 저장' }))
  expect(await screen.findByRole('button', { name: '최신 초안 불러오기' })).toBeVisible()

  const select = screen.getByRole('combobox', { name: '워크플로우 선택' })
  fireEvent.change(select, { target: { value: '43' } })
  expect(await screen.findByRole('textbox', { name: '워크플로우 YAML' })).toHaveValue('name: 다른 초안')
  expect(screen.queryByRole('button', { name: '최신 초안 불러오기' })).not.toBeInTheDocument()
  fireEvent.change(select, { target: { value: '42' } })
  expect(await screen.findByRole('textbox', { name: '워크플로우 YAML' })).toHaveValue('name: 보존할 수정')
  expect(screen.getByRole('button', { name: '최신 초안 불러오기' })).toBeVisible()
})

it('unsavedWorkflowDraft_preventsPwaReload_evenWhenAnotherWorkflowSelected', async () => {
  renderWorkflow({ multiple: true })
  server.use(
    http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [] })),
    http.put('/api/v1/workflows/42/draft', () => HttpResponse.json({ draftUpdatedAt: nextDraftTime, problems: [] })),
  )
  const yaml = await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  expect(hasUnsavedInput()).toBe(false)
  fireEvent.change(yaml, { target: { value: 'name: 나중에 저장' } })
  expect(hasUnsavedInput()).toBe(true)
  const select = screen.getByRole('combobox', { name: '워크플로우 선택' })
  fireEvent.change(select, { target: { value: '43' } })
  fireEvent.change(await screen.findByRole('textbox', { name: '워크플로우 YAML' }), { target: { value: 'name: 버릴 변경' } })
  fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
  expect(hasUnsavedInput()).toBe(true)
  fireEvent.change(select, { target: { value: '42' } })
  expect(await screen.findByRole('textbox', { name: '워크플로우 YAML' })).toHaveValue('name: 나중에 저장')
  fireEvent.click(screen.getByRole('button', { name: '초안 저장' }))
  await waitFor(() => expect(hasUnsavedInput()).toBe(false))
})

it('askFix_passesLatestYamlAndDiagnostics', async () => {
  renderWorkflow()
  const latestYaml = 'name: 최신 입력\nnodes:\n  review:'
  const diagnostics = [workflowProblem, { ...workflowProblem, severity: 'WARNING', line: 1, column: 2, code: 'NAME_HINT', nodeKey: null, message: '이름을 확인하세요.' }]
  server.use(http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: diagnostics })))
  const yaml = await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  fireEvent.change(yaml, { target: { value: 'name: 첫 입력' } })
  fireEvent.change(yaml, { target: { value: latestYaml } })
  await screen.findByText('이름을 확인하세요.')
  fireEvent.click(screen.getByRole('button', { name: 'AI 에게 고치기 부탁' }))
  const prompt = screen.getByTestId('assistant-prompt').textContent ?? ''
  expect(prompt).toContain(latestYaml)
  expect(prompt).not.toContain('첫 입력')
  expect(prompt).toContain(JSON.stringify(diagnostics, null, 2))
})

it('publishSaveThenConflict_keepsSavedDraftClean', async () => {
  const { refreshWorkflow } = renderWorkflow()
  let latest = workflowDetail
  let publishBody: unknown
  const savedYaml = 'name: 저장된 수정'
  server.use(
    http.get('/api/v1/workflows/42', () => HttpResponse.json(latest)),
    http.post('/api/v1/workflows/validate', () => HttpResponse.json({ problems: [] })),
    http.put('/api/v1/workflows/42/draft', () => HttpResponse.json({ draftUpdatedAt: nextDraftTime, problems: [] })),
    http.post('/api/v1/workflows/42/publish', async ({ request }) => {
      publishBody = await request.json()
      return HttpResponse.json({ errors: { code: 'WORKFLOW_DRAFT_CONFLICT' } }, { status: 409 })
    }),
  )
  const yaml = await screen.findByRole('textbox', { name: '워크플로우 YAML' })
  fireEvent.change(yaml, { target: { value: savedYaml } })
  const publish = screen.getByRole('button', { name: '게시' })
  await waitFor(() => expect(publish).toBeEnabled())
  fireEvent.click(publish)
  const dialog = within(screen.getByRole('dialog'))
  await dialog.findByText('진행 중 실행 4은 시작한 버전으로 계속')
  fireEvent.click(dialog.getByRole('button', { name: '게시' }))
  expect(await screen.findByRole('button', { name: '최신 초안 불러오기' })).toBeVisible()
  expect(publishBody).toEqual({ expectedDraftUpdatedAt: nextDraftTime })
  expect(yaml).toHaveValue(savedYaml)
  expect(hasUnsavedInput()).toBe(false)
  latest = { ...workflowDetail, draftYaml: 'name: 이후 외부 변경', draftUpdatedAt: '2026-11-22T10:00:03Z' }
  await act(refreshWorkflow)
  expect(await screen.findByDisplayValue('name: 이후 외부 변경')).toBeVisible()
})
