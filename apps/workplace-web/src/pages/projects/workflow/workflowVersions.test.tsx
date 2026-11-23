import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { expect, it, vi } from 'vitest'

import { server } from '@/test/msw/server'

import { draftTime, nextDraftTime, olderYaml, renderWorkflow, workflowDetail } from './workflowTestSupport'

vi.mock('../components/IssueCreateDialog', () => ({ IssueCreateDialog: () => null }))

it('versionsDiff_showsChangedNodes', async () => {
  renderWorkflow()
  await userEvent.click(await screen.findByRole('tab', { name: '버전' }))
  expect(await screen.findByText('실행 3개')).toBeVisible()
  fireEvent.change(screen.getByRole('combobox', { name: '기준 버전' }), { target: { value: '1' } })
  fireEvent.change(screen.getByRole('combobox', { name: '비교 버전' }), { target: { value: '2' } })
  const nodes = await screen.findByRole('list', { name: '변경된 노드' })
  expect(within(nodes).getByText('check')).toBeVisible()
  expect(within(nodes).getByText('review')).toBeVisible()
  expect(screen.getByText(/- name: 초안/)).toBeVisible()
  expect(screen.getByText(/\+ name: 정리/)).toBeVisible()
})

it('restoreVersion_loadsIntoDraft_notPublished', async () => {
  renderWorkflow()
  let restoredBody: unknown
  server.use(http.post('/api/v1/workflows/42/versions/1/restore-draft', async ({ request }) => {
    restoredBody = await request.json()
    return HttpResponse.json({ ...workflowDetail, draftYaml: olderYaml, draftUpdatedAt: nextDraftTime })
  }))
  await userEvent.click(await screen.findByRole('tab', { name: '버전' }))
  const oldVersion = await screen.findByRole('row', { name: /버전 1/ })
  fireEvent.click(within(oldVersion).getByRole('button', { name: '초안으로 복원' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: '초안으로 복원' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: '워크플로우 YAML' })).toHaveValue(olderYaml))
  expect(restoredBody).toEqual({ expectedDraftUpdatedAt: draftTime })
  expect(screen.getByText('게시 버전 2')).toBeVisible()
})

it('시작 규칙만 바뀐 경우에도 시작 노드를 변경으로 표시한다', async () => {
  renderWorkflow()
  const nodes = [{ key: 'intake', type: 'start' }, { key: 'done', type: 'end' }]
  server.use(
    http.get('/api/v1/workflows/42/versions/1', () => HttpResponse.json({
      versionNo: 1, sourceYaml: 'start: []', model: { nodes, start: [] },
    })),
    http.get('/api/v1/workflows/42/versions/2', () => HttpResponse.json({
      versionNo: 2, sourceYaml: 'start: [{ when: { assigneeRole: reviewer }, to: done }]',
      model: { nodes, start: [{ assigneeRole: 'reviewer', to: 'done' }] },
    })),
  )
  await userEvent.click(await screen.findByRole('tab', { name: '버전' }))
  fireEvent.change(await screen.findByRole('combobox', { name: '기준 버전' }), { target: { value: '1' } })
  fireEvent.change(screen.getByRole('combobox', { name: '비교 버전' }), { target: { value: '2' } })
  const changed = await screen.findByRole('list', { name: '변경된 노드' })
  expect(within(changed).getByText('intake')).toBeVisible()
  expect(within(changed).queryByText('done')).not.toBeInTheDocument()
})

it('restore_confirmationUsesOpenedDraftTimestamp', async () => {
  const { refreshWorkflow } = renderWorkflow()
  let latest = workflowDetail
  let restoredBody: unknown
  server.use(
    http.get('/api/v1/workflows/42', () => HttpResponse.json(latest)),
    http.post('/api/v1/workflows/42/versions/1/restore-draft', async ({ request }) => {
      restoredBody = await request.json()
      return HttpResponse.json({ errors: { code: 'WORKFLOW_DRAFT_CONFLICT' } }, { status: 409 })
    }),
  )
  await userEvent.click(await screen.findByRole('tab', { name: '버전' }))
  const row = await screen.findByRole('row', { name: /버전 1/ })
  fireEvent.click(within(row).getByRole('button', { name: '초안으로 복원' }))
  latest = { ...workflowDetail, draftYaml: 'name: 외부 변경', draftUpdatedAt: nextDraftTime, enabled: true }
  await act(refreshWorkflow)
  await screen.findByText('사용 중')
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '초안으로 복원' }))
  expect(await screen.findByRole('button', { name: '최신 초안 불러오기' })).toBeVisible()
  expect(restoredBody).toEqual({ expectedDraftUpdatedAt: draftTime })
})
