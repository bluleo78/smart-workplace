// 새 이슈 창의 맡길 AI 미리 채우기(WP-1767) — 사람 카드의 「일 맡기기」가 AI 를 골라 둔 채 창을 연다.
// 후보에 있는 id 면 칸이 펼쳐져 그 AI 가 골라지고, 없으면 「이 프로젝트의 멤버가 아님」과 「생성」 버튼, 없이 열면 지금처럼 접힌다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { describe, expect, test } from 'vitest'

import { Button } from '@/components/ui/button'
import { IssueCreateDialog } from '@/pages/projects/components/IssueCreateDialog'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import { renderScreen } from '@/test/renderScreen'

import { systemTypes } from '../../../e2e/factories/issueType.factory'
import { createProject } from '../../../e2e/factories/project.factory'

const KEY = 'WP'
const AGENTS = [
  { id: 5, username: 'my-ai', name: '도우미', personalAssistant: true },
  { id: 7, username: 'team-ai', name: '팀 AI', personalAssistant: false },
]

/** 「+ 새 태스크」 버튼 + initialAgentId 를 받는 대화상자. */
function Harness({ initialAgentId }: { initialAgentId?: number }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>+ 새 태스크</Button>
      <IssueCreateDialog projectKey={KEY} open={open} onOpenChange={setOpen} initialAgentId={initialAgentId} />
    </>
  )
}

/** 창을 연다. */
async function openWith(initialAgentId?: number) {
  const view = renderScreen(<Harness initialAgentId={initialAgentId} />, {
    path: `/projects/${KEY}`,
    handlers: [
      http.get(`/api/v1/projects/${KEY}/recurrence-agents`, () => HttpResponse.json(AGENTS)),
      http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY }))),
      http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
      http.get(`/api/v1/projects/${KEY}/:sub`, () => HttpResponse.json([])),
    ],
  })
  await view.user.click(await screen.findByRole('button', { name: '+ 새 태스크' }, { timeout: SCREEN_LOAD_TIMEOUT }))
  const dialog = await screen.findByRole('dialog', { name: '새 이슈' })
  return { ...view, dialog }
}

describe('새 이슈 창 — initialAgentId (WP-1767)', () => {
  test('후보에 있는 AI id 로 열면 칸이 펼쳐지고 그 AI 가 골라져 있다', async () => {
    const { dialog } = await openWith(7)
    const panel = await within(dialog).findByTestId('create-ai-handoff-panel')
    await waitFor(() => expect(within(panel).getByRole('combobox', { name: '담당 AI' })).toHaveTextContent('팀 AI'))
    expect(within(dialog).getByRole('button', { name: '만들고 지금 실행' })).toBeInTheDocument()
    expect(within(panel).queryByText('이 프로젝트의 멤버가 아님')).toBeNull()
  })

  test('후보에 없는 id 면 「이 프로젝트의 멤버가 아님」이 보이고 버튼은 「생성」이다', async () => {
    const { dialog } = await openWith(99)
    const panel = await within(dialog).findByTestId('create-ai-handoff-panel')
    expect(await within(panel).findByText('이 프로젝트의 멤버가 아님')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '생성' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '만들고 지금 실행' })).toBeNull()
  })

  test('멤버가 아닌 AI 로 열려도 안내 아래 칸에서 다른 AI 를 고를 수 있고, 고르면 안내가 사라지고 버튼이 바뀐다', async () => {
    const { dialog, user } = await openWith(99)
    const panel = await within(dialog).findByTestId('create-ai-handoff-panel')
    expect(await within(panel).findByText('이 프로젝트의 멤버가 아님')).toBeInTheDocument()
    await user.click(within(panel).getByRole('combobox', { name: '담당 AI' }))
    await user.click(await screen.findByRole('option', { name: '팀 AI' }))
    await waitFor(() => expect(within(panel).getByRole('combobox', { name: '담당 AI' })).toHaveTextContent('팀 AI'))
    expect(within(panel).queryByText('이 프로젝트의 멤버가 아님')).toBeNull()
    expect(within(dialog).getByRole('button', { name: '만들고 지금 실행' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '만들기만' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '생성' })).toBeNull()
  })

  test('initialAgentId 없이 열면 지금처럼 접혀 있다', async () => {
    const { dialog } = await openWith()
    expect(within(dialog).getByTestId('create-ai-handoff-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(within(dialog).queryByTestId('create-ai-handoff-panel')).toBeNull()
    expect(within(dialog).getByRole('button', { name: '생성' })).toBeInTheDocument()
  })
})
