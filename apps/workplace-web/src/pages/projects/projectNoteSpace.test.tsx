// 프로젝트 설정의 「노트 공간」 영역(WP-1480) — 화면 테스트.
// 소유자에게만 보임(팀 프로젝트 멤버·개인 프로젝트는 없음), 지금 공간 이름 링크, 후보 고르기(내가 소유자인 연결 안 된 팀 공간만) →
// 경고 확인 → PUT payload, 성공 뒤 이름 갱신, 409 의 서버 한국어 메시지 토스트를 MSW 로 본다.
import { screen, waitFor, within } from '@testing-library/react'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import { wikiKeys } from '@/hooks/queries/wikiKeys'
import ProjectSettingsPage from '@/pages/projects/ProjectSettingsPage'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { server } from '@/test/msw/server'
import { renderScreen } from '@/test/renderScreen'
import type { WikiProjectSpace, WikiSpace } from '@/types/wiki'

import { createMember, createProject } from '../../../e2e/factories/project.factory'
import { wikiSpace } from '../../../e2e/factories/wiki.factory'
import { LINK_WARNING, ProjectNoteSpaceSettings } from './components/ProjectNoteSpaceSettings'

const KEY = 'WP'
const SPACE_API = `/api/v1/wiki/project-spaces/${KEY}`

/** 노트 공간 목록 — 후보는 「가나팀」(2)·「제품팀」(3)뿐. 편집자인 팀 공간·개인·이미 연결된 공간은 후보가 아니다. */
const SPACES: WikiSpace[] = [
  wikiSpace({ id: 1, type: 'PERSONAL', name: '내 노트', role: 'OWNER' }),
  wikiSpace({ id: 3, name: '제품팀', role: 'OWNER' }),
  wikiSpace({ id: 2, name: '가나팀', role: 'OWNER' }),
  wikiSpace({ id: 4, name: '디자인팀', role: 'EDITOR' }),
  wikiSpace({ id: 5, name: '모바일 앱', role: 'OWNER', projectKey: 'MOB' }),
  wikiSpace({ id: 9, name: 'Smart Workplace', role: 'OWNER', projectKey: KEY }),
]

/** 노트 공간 영역만 띄운다 — 연결 요청 본문을 모으고, link 응답(성공·실패)은 인자로 고른다. */
function renderSection(linkResponse: () => Response = () => HttpResponse.json<WikiProjectSpace>({ id: 3, name: '제품팀', projectKey: KEY })) {
  const linkBodies: unknown[] = []
  // 지금 연결된 공간 — 연결이 성공하면 서버처럼 바뀐다(성공 뒤 요약을 다시 받아도 새 공간이 보이게).
  let current: WikiProjectSpace = { id: 9, name: 'Smart Workplace', projectKey: KEY }
  const view = renderScreen(<ProjectNoteSpaceSettings projectKey={KEY} />, {
    handlers: [
      http.get(SPACE_API, () => HttpResponse.json<WikiProjectSpace>(current)),
      http.get('/api/v1/wiki/spaces', () => HttpResponse.json(SPACES)),
      http.put(`${SPACE_API}/link`, async ({ request }) => {
        linkBodies.push(await request.json())
        const res = linkResponse()
        if (res.ok) current = (await res.clone().json()) as WikiProjectSpace
        return res
      }),
    ],
  })
  return { ...view, linkBodies }
}

describe('노트 공간 영역', () => {
  test('지금 공간 이름이 노트로 가는 링크로 보인다', async () => {
    renderSection()
    const link = await screen.findByTestId('project-note-space-link')
    expect(link).toHaveTextContent('Smart Workplace')
    expect(link).toHaveAttribute('href', '/wiki/spaces/9')
  })

  test('공간이 없으면(404) 없다는 안내가 보이고 연결 단추는 그대로 있다', async () => {
    renderScreen(<ProjectNoteSpaceSettings projectKey={KEY} />, {
      handlers: [http.get(SPACE_API, () => HttpResponse.json({ message: '없음' }, { status: 404 }))],
    })
    expect(await screen.findByTestId('project-note-space-empty')).toHaveTextContent('연결된 노트 공간이 없어요.')
    expect(screen.getByTestId('project-note-space-link-open')).toBeInTheDocument()
  })

  test('후보는 내가 소유자인 연결 안 된 팀 공간뿐이고, 고르고 경고를 확인하면 그 공간 id 로 연결한다', async () => {
    const { user, linkBodies } = renderSection()
    await screen.findByTestId('project-note-space-link')
    await user.click(screen.getByTestId('project-note-space-link-open'))

    const picker = await screen.findByTestId('project-note-space-picker')
    const radios = await within(picker).findAllByRole('radio')
    // 이름 순 — 가나팀, 제품팀. 편집자인 디자인팀·개인·연결된 공간은 없다.
    expect(radios.map((r) => r.closest('label')?.textContent)).toEqual(['가나팀', '제품팀'])
    expect(within(picker).getByTestId('project-note-space-link-next')).toBeDisabled()

    await user.click(within(picker).getByRole('radio', { name: '제품팀' }))
    await user.click(within(picker).getByTestId('project-note-space-link-next'))

    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('「제품팀」 공간을 연결할까요?')
    expect(confirm).toHaveTextContent(LINK_WARNING)
    // 연결하면 공간 이름이 프로젝트 이름을 따라간다는 안내도 함께 보인다.
    expect(confirm).toHaveTextContent('공간 이름이 앞으로 프로젝트 이름을 따라갑니다.')
    await user.click(within(confirm).getByTestId('project-note-space-link-confirm'))

    expect(await screen.findByText('「제품팀」 공간을 이 프로젝트의 노트 공간으로 연결했어요')).toBeInTheDocument()
    expect(linkBodies).toEqual([{ spaceId: 3 }])
    // 응답으로 받은 공간이 지금 공간으로 바뀌고 창은 닫힌다.
    expect(await screen.findByTestId('project-note-space-link')).toHaveTextContent('제품팀')
    expect(screen.queryByTestId('project-note-space-picker')).not.toBeInTheDocument()
  })

  test('서버가 409 로 거절하면 서버의 한국어 사유를 토스트로 보인다', async () => {
    const { user } = renderSection(() =>
      HttpResponse.json({ message: '이미 다른 프로젝트에 연결된 공간입니다' }, { status: 409 }),
    )
    await screen.findByTestId('project-note-space-link')
    await user.click(screen.getByTestId('project-note-space-link-open'))
    const picker = await screen.findByTestId('project-note-space-picker')
    await user.click(await within(picker).findByRole('radio', { name: '가나팀' }))
    await user.click(within(picker).getByTestId('project-note-space-link-next'))
    await user.click(within(await screen.findByRole('alertdialog')).getByTestId('project-note-space-link-confirm'))

    expect(await screen.findByText('이미 다른 프로젝트에 연결된 공간입니다')).toBeInTheDocument()
    // 지금 공간은 그대로다.
    expect(screen.getByTestId('project-note-space-link')).toHaveTextContent('Smart Workplace')
  })

  test('404 가 아닌 실패면 「없다」 대신 다시 시도 안내를 보이고 연결 단추를 숨긴다 — 다시 시도로 이름이 보인다', async () => {
    let fail = true
    const { user } = renderScreen(<ProjectNoteSpaceSettings projectKey={KEY} />, {
      handlers: [
        http.get(SPACE_API, () =>
          fail
            ? HttpResponse.json({ message: '서버 오류' }, { status: 500 })
            : HttpResponse.json<WikiProjectSpace>({ id: 9, name: 'Smart Workplace', projectKey: KEY }),
        ),
      ],
    })
    const error = await screen.findByTestId('project-note-space-error')
    expect(screen.queryByTestId('project-note-space-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('project-note-space-link-open')).not.toBeInTheDocument()

    fail = false
    await user.click(within(error).getByRole('button', { name: /다시 시도/ }))
    expect(await screen.findByTestId('project-note-space-link')).toHaveTextContent('Smart Workplace')
    expect(screen.getByTestId('project-note-space-link-open')).toBeInTheDocument()
  })

  test('확인 창이 떠 있는 동안 후보 목록이 바뀌어 고른 공간이 빠져도 제목과 연결 대상은 고른 공간 그대로다', async () => {
    let spaces = SPACES
    const linkBodies: unknown[] = []
    const { user, queryClient } = renderScreen(<ProjectNoteSpaceSettings projectKey={KEY} />, {
      handlers: [
        http.get(SPACE_API, () => HttpResponse.json<WikiProjectSpace>({ id: 9, name: 'Smart Workplace', projectKey: KEY })),
        http.get('/api/v1/wiki/spaces', () => HttpResponse.json(spaces)),
        http.put(`${SPACE_API}/link`, async ({ request }) => {
          linkBodies.push(await request.json())
          return HttpResponse.json<WikiProjectSpace>({ id: 2, name: '가나팀', projectKey: KEY })
        }),
      ],
    })
    await screen.findByTestId('project-note-space-link')
    await user.click(screen.getByTestId('project-note-space-link-open'))
    const picker = await screen.findByTestId('project-note-space-picker')
    await user.click(await within(picker).findByRole('radio', { name: '가나팀' }))
    await user.click(within(picker).getByTestId('project-note-space-link-next'))
    const confirm = await screen.findByRole('alertdialog')

    // 다른 곳에서 「가나팀」 이 먼저 연결돼 목록에서 빠진다.
    spaces = SPACES.filter((s) => s.id !== 2)
    await queryClient.refetchQueries({ queryKey: wikiKeys.spaces() })
    expect(within(picker).queryByRole('radio', { name: '가나팀' })).not.toBeInTheDocument()
    expect(confirm).toHaveTextContent('「가나팀」 공간을 연결할까요?')

    await user.click(within(confirm).getByTestId('project-note-space-link-confirm'))
    expect(await screen.findByText('「가나팀」 공간을 이 프로젝트의 노트 공간으로 연결했어요')).toBeInTheDocument()
    expect(linkBodies).toEqual([{ spaceId: 2 }])
  })

  test('연결 요청 중에는 Esc·취소로 확인 창이 닫히지 않고 취소가 막힌다', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { user } = renderSection(() => HttpResponse.json<WikiProjectSpace>({ id: 3, name: '제품팀', projectKey: KEY }))
    // 응답을 붙잡아 두는 처리기를 앞에 둔다 — 풀기 전까지 요청이 끝나지 않는다.
    server.use(
      http.put(`${SPACE_API}/link`, async () => {
        await gate
        return HttpResponse.json<WikiProjectSpace>({ id: 3, name: '제품팀', projectKey: KEY })
      }),
    )
    await screen.findByTestId('project-note-space-link')
    await user.click(screen.getByTestId('project-note-space-link-open'))
    const picker = await screen.findByTestId('project-note-space-picker')
    await user.click(await within(picker).findByRole('radio', { name: '제품팀' }))
    await user.click(within(picker).getByTestId('project-note-space-link-next'))
    const confirm = await screen.findByRole('alertdialog')
    await user.click(within(confirm).getByTestId('project-note-space-link-confirm'))

    const cancel = within(confirm).getByTestId('project-note-space-link-cancel')
    await waitFor(() => expect(cancel).toBeDisabled())
    await user.keyboard('{Escape}')
    await user.click(cancel)
    expect(screen.getByRole('alertdialog')).toHaveTextContent('「제품팀」 공간을 연결할까요?')

    release()
    expect(await screen.findByText('「제품팀」 공간을 이 프로젝트의 노트 공간으로 연결했어요')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  test('후보가 없으면 고르기 창에 이유가 보이고 연결… 은 막혀 있다', async () => {
    const { user } = renderScreen(<ProjectNoteSpaceSettings projectKey={KEY} />, {
      handlers: [
        http.get(SPACE_API, () => HttpResponse.json<WikiProjectSpace>({ id: 9, name: 'Smart Workplace', projectKey: KEY })),
        http.get('/api/v1/wiki/spaces', () => HttpResponse.json([SPACES[0], SPACES[3], SPACES[5]])),
      ],
    })
    await screen.findByTestId('project-note-space-link')
    await user.click(screen.getByTestId('project-note-space-link-open'))
    expect(await screen.findByTestId('project-note-space-no-candidates')).toBeInTheDocument()
    expect(screen.getByTestId('project-note-space-link-next')).toBeDisabled()
  })
})

/** 설정 화면 — 프로젝트·멤버(나 = userId 1 의 역할)·필드·상태별 이슈 수 + 노트 공간 요약. */
function settingsHandlers(type: 'TEAM' | 'PERSONAL', myRole: 'OWNER' | 'MEMBER'): RequestHandler[] {
  const project = createProject({ id: 12, key: KEY, type })
  const base = `/api/v1/projects/${KEY}`
  return [
    http.get(base, () => HttpResponse.json(project)),
    http.get(`${base}/members`, () => HttpResponse.json([createMember({ userId: 1, role: myRole })])),
    http.get(`${base}/member-groups`, () => HttpResponse.json([])),
    http.get(`${base}/fields`, () => HttpResponse.json([])),
    http.get(`${base}/issues/group-counts`, () => HttpResponse.json({ groupBy: 'statusId', groups: [] })),
    http.get(SPACE_API, () => HttpResponse.json<WikiProjectSpace>({ id: 9, name: 'Smart Workplace', projectKey: KEY })),
  ]
}

const renderSettings = (handlers: RequestHandler[]) =>
  renderScreen(
    <Routes>
      <Route path="/projects/:key/settings" element={<ProjectSettingsPage />} />
    </Routes>,
    { path: `/projects/${KEY}/settings`, handlers: [...handlers, ...shellHandlers] },
  )

describe('설정 화면의 노트 공간 영역 노출', () => {
  test('팀 프로젝트 소유자에게 보인다', async () => {
    renderSettings(settingsHandlers('TEAM', 'OWNER'))
    expect(await screen.findByTestId('project-note-space-link')).toHaveTextContent('Smart Workplace')
  })

  test('팀 프로젝트 멤버(소유자 아님)에게는 없다', async () => {
    renderSettings(settingsHandlers('TEAM', 'MEMBER'))
    // 멤버 목록이 그려진 뒤(= 소유자 여부를 안 뒤)에 본다 — 받기 전엔 누구에게나 없어서 거짓으로 통과한다.
    expect(await screen.findByText('Tester')).toBeInTheDocument()
    expect(screen.queryByTestId('project-note-space')).not.toBeInTheDocument()
  })

  test('개인 프로젝트에는 없다', async () => {
    renderSettings(settingsHandlers('PERSONAL', 'OWNER'))
    expect(await screen.findByRole('heading', { name: '기본 정보' })).toBeInTheDocument()
    expect(screen.queryByTestId('project-note-space')).not.toBeInTheDocument()
  })
})
