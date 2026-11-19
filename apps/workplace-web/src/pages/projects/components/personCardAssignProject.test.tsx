// 프로젝트 없이 연 「일 맡기기」(WP-1768) — 채팅·노트처럼 프로젝트가 정해지지 않은 곳의 AI 카드는 전역 호스트가 새 이슈 창을 연다.
// 창은 맨 위 「프로젝트」 칸에서 내가 속한 팀 프로젝트를 고르게 하고(개인·접수 전용 제외), 고른 프로젝트로 맡길 AI 를 다시 판정한다.
// 이슈 상세 안(가까운 호스트가 projectKey 를 줌)에서는 프로젝트 칸 없이 그 이슈의 프로젝트로 고정된다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { PersonCardTrigger } from '@/components/users/personCard/PersonCardTrigger'
import { ISSUE_PRIORITY_LABEL } from '@/lib/issueGrouping'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import { renderScreen } from '@/test/renderScreen'

import { createIssue } from '../../../../e2e/factories/issue.factory'
import { systemTypes } from '../../../../e2e/factories/issueType.factory'
import { createProject } from '../../../../e2e/factories/project.factory'
import { GlobalPersonCardAssignHost, PersonCardAssignHost } from './PersonCardAssignHost'

const AGENT = { id: 9, username: 'reviewbot', name: '리뷰봇', kind: 'AGENT' as const }
const PRIORITY_HIGH = ISSUE_PRIORITY_LABEL.HIGH
const OTHER_AI = { id: 11, username: 'otherbot', name: '다른봇', personalAssistant: false }

/** 목록 순서 — 개인·접수 전용이 앞에 있어도 첫 「팀」 프로젝트(알파)가 골라져야 한다. 리뷰봇은 알파에만 있다. */
const PROJECTS = [
  createProject({ id: 1, key: 'ME', name: '내 일', type: 'PERSONAL', isDefault: true }),
  createProject({ id: 2, key: 'DESK', name: '접수함', type: 'OPEN', viewerIsMember: false }),
  createProject({ id: 3, key: 'ALPHA', name: '알파 팀' }),
  createProject({ id: 4, key: 'BETA', name: '베타 팀' }),
]

/** 프로젝트별 맡길 AI 후보 — 알파는 리뷰봇, 베타는 다른 AI 만. */
const AGENTS_BY_KEY: Record<string, unknown[]> = {
  ALPHA: [{ id: AGENT.id, username: AGENT.username, name: AGENT.name, personalAssistant: false }],
  BETA: [OTHER_AI],
}

/** 카드(프로필·AI 현황)와 새 이슈 창(프로젝트 목록·유형·후보·만들기)이 부르는 것. created 에 만들기 요청을 「키:제목:우선순위」로 모은다. */
function handlers(created: string[]) {
  return [
    http.get('/api/v1/members/:id', () =>
      HttpResponse.json({
        userId: AGENT.id, username: AGENT.username, name: AGENT.name, email: null, title: null, kind: 'AGENT',
        active: true, membershipRole: null, membershipStatus: null, department: null,
      }),
    ),
    http.get('/api/v1/me/ai-agents', () => HttpResponse.json({ agents: [] })),
    http.get('/api/v1/mail/accounts', () => HttpResponse.json([])),
    http.get('/api/v1/projects', () =>
      HttpResponse.json({ content: PROJECTS, page: 0, size: 100, totalElements: PROJECTS.length, totalPages: 1 }),
    ),
    http.get('/api/v1/projects/:key/types', () => HttpResponse.json(systemTypes())),
    http.get('/api/v1/projects/:key/recurrence-agents', ({ params }) => HttpResponse.json(AGENTS_BY_KEY[String(params.key)] ?? [])),
    http.get('/api/v1/projects/:key/:sub', () => HttpResponse.json([])),
    http.get('/api/v1/projects/:key', ({ params }) =>
      HttpResponse.json(PROJECTS.find((p) => p.key === params.key) ?? createProject({ key: String(params.key) })),
    ),
    // 본문 이미지(WP-1768 잠금 테스트) — 칸 안 그림이 부르는 파일, 업로드는 끝나지 않게 두어 「올리는 중」을 만든다.
    http.get('/api/v1/projects/:key/issue-images/:id', () => new HttpResponse(new Blob(['x'], { type: 'image/png' }))),
    http.post('/api/v1/projects/:key/issue-images', () => new Promise<never>(() => {})),
    http.post('/api/v1/projects/:key/issues', async ({ params, request }) => {
      const body = (await request.json()) as { title?: string; priority?: string }
      created.push(`${String(params.key)}:${body.title}:${body.priority}`)
      return HttpResponse.json(createIssue({ id: 77, number: 7, projectKey: String(params.key) }), { status: 201 })
    }),
  ]
}

/**
 * 호스트 안의 리뷰봇 카드에서 「일 맡기기」를 눌러 새 이슈 창을 연다. inner 가 있으면 그 projectKey 의 호스트를 하나 더 둔다(이슈 상세 흉내).
 * path 가 있으면 앱 셸의 전역 호스트(GlobalPersonCardAssignHost)를 그 주소에서 띄운다 — 주소의 프로젝트가 처음 값 힌트가 된다.
 */
async function openAssign({ inner, path }: { inner?: string; path?: string } = {}) {
  const created: string[] = []
  const trigger = <PersonCardTrigger person={AGENT}>{AGENT.name}</PersonCardTrigger>
  const content = inner ? <PersonCardAssignHost projectKey={inner}>{trigger}</PersonCardAssignHost> : trigger
  const view = renderScreen(
    path ? <GlobalPersonCardAssignHost>{content}</GlobalPersonCardAssignHost> : <PersonCardAssignHost>{content}</PersonCardAssignHost>,
    { handlers: handlers(created), path },
  )
  await view.user.click(await screen.findByTestId(`person-card-trigger-${AGENT.id}`, {}, { timeout: SCREEN_LOAD_TIMEOUT }))
  const card = await screen.findByTestId('person-card')
  await view.user.click(await within(card).findByRole('button', { name: '일 맡기기' }))
  // 프로젝트 목록을 받기 전에는 폼 대신 안내 창이 잠깐 뜬다 — 폼(제목 칸)이 그려진 창을 잡는다.
  const title = await screen.findByLabelText(/제목/, {}, { timeout: SCREEN_LOAD_TIMEOUT })
  const dialog = title.closest<HTMLElement>('[role="dialog"]')!
  expect(dialog).toHaveAccessibleName('새 이슈')
  return { ...view, dialog, created }
}

/** 프로젝트 칸에서 이름으로 고른다. */
async function pickProject(user: ReturnType<typeof renderScreen>['user'], dialog: HTMLElement, name: string) {
  await user.click(await within(dialog).findByRole('combobox', { name: '프로젝트' }))
  await user.click(await screen.findByRole('option', { name }))
}

/** 본문 칸에 붙여넣는다 — 글자(text) 또는 이미지 파일(file). */
function pasteIntoBody(dialog: HTMLElement, data: { text?: string; file?: File }) {
  const clipboardData = {
    getData: (type: string) => (type === 'text/plain' ? data.text ?? '' : ''),
    types: data.file ? ['Files'] : ['text/plain'],
    files: (data.file ? [data.file] : []) as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
  }
  act(() => {
    fireEvent.paste(within(dialog).getByTestId('issue-body'), { clipboardData })
  })
}

/** 담당 AI 칸 — 맡기기 칸이 펼쳐진 상태에서 찾는다. */
async function agentPanel(dialog: HTMLElement) {
  return within(dialog).findByTestId('create-ai-handoff-panel')
}

describe('프로젝트 없이 연 「일 맡기기」 창 (WP-1768)', () => {
  test('프로젝트 없이 연 일 맡기기 창은 프로젝트 칸을 보이고 첫 팀 프로젝트가 골라져 있다', async () => {
    const { dialog, user } = await openAssign()
    const field = await within(dialog).findByRole('combobox', { name: '프로젝트' })
    expect(field).toHaveTextContent('알파 팀')
    // 처음 판정은 알파 — 리뷰봇이 멤버라 그대로 골라진다.
    const panel = await agentPanel(dialog)
    await waitFor(() => expect(within(panel).getByRole('combobox', { name: '담당 AI' })).toHaveTextContent(AGENT.name))
    // 목록에는 내가 속한 팀 프로젝트만 — 개인·접수 전용은 없다.
    await user.click(field)
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['알파 팀', '베타 팀'])
  })

  test('그 AI 가 멤버가 아닌 프로젝트를 고르면 담당 AI 가 비고 「이 프로젝트의 멤버가 아님」이 보인다', async () => {
    const { dialog, user } = await openAssign()
    const panel = await agentPanel(dialog)
    await waitFor(() => expect(within(panel).getByRole('combobox', { name: '담당 AI' })).toHaveTextContent(AGENT.name))
    await pickProject(user, dialog, '베타 팀')
    const after = await agentPanel(dialog)
    expect(await within(after).findByText('이 프로젝트의 멤버가 아님')).toBeInTheDocument()
    const agentField = within(after).getByRole('combobox', { name: '담당 AI' })
    expect(agentField).not.toHaveTextContent(AGENT.name)
    expect(agentField).not.toHaveTextContent(OTHER_AI.name)
  })

  test('다시 멤버인 프로젝트를 고르면 표시가 걷히고 그 AI 가 골라진다', async () => {
    const { dialog, user } = await openAssign()
    await within(await agentPanel(dialog)).findByRole('combobox', { name: '담당 AI' })
    await pickProject(user, dialog, '베타 팀')
    expect(await within(await agentPanel(dialog)).findByText('이 프로젝트의 멤버가 아님')).toBeInTheDocument()
    await pickProject(user, dialog, '알파 팀')
    const panel = await agentPanel(dialog)
    await waitFor(() => expect(within(panel).getByRole('combobox', { name: '담당 AI' })).toHaveTextContent(AGENT.name))
    expect(within(panel).queryByText('이 프로젝트의 멤버가 아님')).toBeNull()
  })

  test('프로젝트를 바꿔도 입력한 제목은 남는다', async () => {
    const { dialog, user } = await openAssign()
    await within(dialog).findByRole('combobox', { name: '프로젝트' })
    await user.type(within(dialog).getByLabelText(/제목/), '리뷰 부탁')
    await pickProject(user, dialog, '베타 팀')
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: '프로젝트' })).toHaveTextContent('베타 팀'))
    expect(within(dialog).getByLabelText(/제목/)).toHaveValue('리뷰 부탁')
  })

  test('만들기는 고른 프로젝트로 요청한다 — 제목은 남고 나머지 값은 처음으로', async () => {
    const { dialog, user, created } = await openAssign()
    await within(dialog).findByRole('combobox', { name: '프로젝트' })
    await user.type(within(dialog).getByLabelText(/제목/), '베타에 만들기')
    // 앞 프로젝트에서 바꾼 우선순위는 프로젝트를 바꾸면 처음(MID)으로 돌아간다 — 제목만 남는다.
    await user.click(within(dialog).getByRole('combobox', { name: '우선순위' }))
    await user.click(await screen.findByRole('option', { name: PRIORITY_HIGH }))
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: '우선순위' })).toHaveTextContent(PRIORITY_HIGH))
    await pickProject(user, dialog, '베타 팀')
    // 베타에서는 리뷰봇이 멤버가 아니라 맡기기가 빠지고 평소 「생성」이다.
    expect(await within(await agentPanel(dialog)).findByText('이 프로젝트의 멤버가 아님')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(created).toEqual(['BETA:베타에 만들기:MID']))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '새 이슈' })).not.toBeInTheDocument())
  })

  test('이슈 상세 호스트(projectKey 있음) 안에서는 프로젝트 칸이 없다', async () => {
    const { dialog } = await openAssign({ inner: 'ALPHA' })
    const panel = await agentPanel(dialog)
    await waitFor(() => expect(within(panel).getByRole('combobox', { name: '담당 AI' })).toHaveTextContent(AGENT.name))
    expect(within(dialog).queryByRole('combobox', { name: '프로젝트' })).toBeNull()
  })

  test('본문에 이슈 이미지를 넣으면 프로젝트 칸이 잠기고 이유를 보인다 — 이미지는 그 프로젝트에만 이어진다', async () => {
    const { dialog } = await openAssign()
    const field = await within(dialog).findByRole('combobox', { name: '프로젝트' })
    expect(field).toBeEnabled()
    expect(within(dialog).queryByText('이미지를 넣은 뒤에는 프로젝트를 바꿀 수 없습니다')).toBeNull()
    pasteIntoBody(dialog, { text: '스크린샷 ![a.png](/api/v1/projects/ALPHA/issue-images/5)' })
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: '프로젝트' })).toBeDisabled())
    expect(within(dialog).getByText('이미지를 넣은 뒤에는 프로젝트를 바꿀 수 없습니다')).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: '프로젝트' })).toHaveTextContent('알파 팀')
  })

  test('이미지를 올리는 중에도 프로젝트 칸이 잠긴다', async () => {
    const { dialog } = await openAssign()
    expect(await within(dialog).findByRole('combobox', { name: '프로젝트' })).toBeEnabled()
    pasteIntoBody(dialog, { file: new File(['x'], 'shot.png', { type: 'image/png' }) })
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: '프로젝트' })).toBeDisabled())
    expect(within(dialog).getByText('이미지를 넣은 뒤에는 프로젝트를 바꿀 수 없습니다')).toBeInTheDocument()
  })

  test('다른 프로젝트 이미지가 든 본문은 프로젝트 칸을 잠그지 않는다 — 지금 프로젝트 이미지만 잠근다', async () => {
    const { dialog } = await openAssign()
    expect(await within(dialog).findByRole('combobox', { name: '프로젝트' })).toBeEnabled()
    pasteIntoBody(dialog, { text: '참고 ![b.png](/api/v1/projects/BETA/issue-images/5)' })
    await waitFor(() => expect(within(dialog).getByTestId('issue-body')).toHaveTextContent('참고'))
    expect(within(dialog).getByRole('combobox', { name: '프로젝트' })).toBeEnabled()
    expect(within(dialog).queryByText('이미지를 넣은 뒤에는 프로젝트를 바꿀 수 없습니다')).toBeNull()
    // 지금 프로젝트(알파) 이미지를 더하면 그때 잠긴다.
    pasteIntoBody(dialog, { text: ' ![a.png](/api/v1/projects/ALPHA/issue-images/6)' })
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: '프로젝트' })).toBeDisabled())
  })

  test('전역 호스트는 프로젝트 화면 주소의 프로젝트를 처음 값으로 고르고, 칸은 남아 바꿀 수 있다', async () => {
    const { dialog, user } = await openAssign({ path: '/projects/BETA/timeline' })
    const field = await within(dialog).findByRole('combobox', { name: '프로젝트' })
    await waitFor(() => expect(field).toHaveTextContent('베타 팀'))
    expect(field).toBeEnabled()
    await pickProject(user, dialog, '알파 팀')
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: '프로젝트' })).toHaveTextContent('알파 팀'))
  })

  test('전역 호스트는 고를 수 없는 프로젝트(개인) 화면에서는 첫 팀 프로젝트로 떨어진다', async () => {
    const { dialog } = await openAssign({ path: '/projects/ME' })
    const field = await within(dialog).findByRole('combobox', { name: '프로젝트' })
    expect(field).toHaveTextContent('알파 팀')
  })

  test('팀 프로젝트가 하나도 없으면 폼 대신 안내만 보인다', async () => {
    const created: string[] = []
    const view = renderScreen(
      <PersonCardAssignHost><PersonCardTrigger person={AGENT}>{AGENT.name}</PersonCardTrigger></PersonCardAssignHost>,
      {
        handlers: [
          http.get('/api/v1/projects', () =>
            HttpResponse.json({ content: PROJECTS.slice(0, 2), page: 0, size: 100, totalElements: 2, totalPages: 1 }),
          ),
          ...handlers(created),
        ],
      },
    )
    await view.user.click(await screen.findByTestId(`person-card-trigger-${AGENT.id}`, {}, { timeout: SCREEN_LOAD_TIMEOUT }))
    await view.user.click(await within(await screen.findByTestId('person-card')).findByRole('button', { name: '일 맡기기' }))
    const dialog = await screen.findByRole('dialog', { name: '새 이슈' })
    expect(await within(dialog).findByText('이슈를 만들 수 있는 팀 프로젝트가 없습니다')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/제목/)).toBeNull()
  })
})
