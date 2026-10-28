// @vitest-environment jsdom
// happy-dom(화면 테스트 기본, WP-1002)과 날짜 칸·글자 수 제한·포커스 이동 처리가 달라 이 파일은 jsdom 에서 돈다.
// 드라이브 사이드바(DriveSidebar) — 화면 컴포넌트 테스트(WP-971, WP-995, WP-984).
// 팀 공간 만들기 대화상자(#582·#696): 빈 이름 비활성·연속 클릭 1회 요청·취소 뒤 입력 초기화·409 인라인 에러·만든 공간이 목록에 보임
// — e2e/pages/drive/drive-space-create.spec.ts·drive.spec.ts 에서 옮겼다.
// 사이드바 머리말·사용량 바(경고색·클램프)·채널 공간 숨김, 팀 공간 ⋯ 이름 변경·삭제·멤버 창(추가·역할·제거·잠금)도 브라우저 없이 판정되므로
// drive.spec.ts·drive-space-rename-delete.spec.ts·drive-space-members.spec.ts 에서 옮겼다.
// 포커스 복원·타이머 지연 입력·터치 태블릿 ⋯ 크기는 E2E(@input·@layout)가, 드라이브 화면 배선은 drive.spec.ts 의 E2E 가 지킨다.
// 대화상자를 가진 사이드바만 renderScreen 으로 띄운다 — App 전체(renderPage)일 때 11.7초, 지금 6.3초.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { DriveSidebar } from '@/components/drive/DriveSidebar'
import { renderScreen } from '@/test/renderScreen'
import type { DriveMember, DriveSpace } from '@/types/drive'

import { createMember } from '../../../e2e/factories/auth.factory'

const NEW_SPACE_ID = 9

const personalSpace: DriveSpace = {
  id: 1,
  type: 'PERSONAL',
  name: '내 드라이브',
  ownerId: 1,
  role: 'OWNER',
  archived: false,
  createdAt: '2026-06-01T00:00:00Z',
}

/** 사이드바가 부르는 공간 목록·쿼터(공간·항목 조회는 이동한 뒤 화면 몫이라 여기선 쓰이지 않을 수 있다). POST 는 테스트마다 따로 준다. */
const driveHandlers = (created: { space: DriveSpace | null }) => [
  http.get('/api/v1/drive/quota', () => HttpResponse.json({ usedBytes: 0, quotaBytes: 1024 * 1024 * 1024 })),
  http.get('/api/v1/drive/spaces', () =>
    HttpResponse.json([personalSpace, ...(created.space ? [created.space] : [])]),
  ),
  // /drive 는 개인 공간(/drive/spaces/1)으로 넘어가며 공간 하나를 조회한다.
  http.get('/api/v1/drive/spaces/:id', () => HttpResponse.json(personalSpace)),
  http.get('/api/v1/drive/spaces/:id/items', () => HttpResponse.json({ folders: [], files: [] })),
]

/** 드라이브를 열고 「팀 공간 만들기」 대화상자를 띄운다. */
async function openCreateDialog(extra: NonNullable<Parameters<typeof renderScreen>[1]> = {}) {
  const created: { space: DriveSpace | null } = { space: null }
  const view = renderScreen(<DriveSidebar />, { ...extra, path: '/drive', handlers: [...(extra.handlers ?? []), ...driveHandlers(created)] })
  await view.user.click(await screen.findByRole('button', { name: '팀 공간 만들기' }))
  await screen.findByTestId('space-name-dialog')
  return { ...view, created }
}

test('팀 공간 이름이 비거나 공백뿐이면 만들기 버튼이 비활성', async () => {
  const { user } = await openCreateDialog()
  expect(screen.getByTestId('space-name-confirm')).toBeDisabled()
  await user.type(screen.getByTestId('space-name-input'), '   ')
  expect(screen.getByTestId('space-name-confirm')).toBeDisabled()
})

test('만들기 버튼을 같은 틱에 두 번 눌러도 생성 요청은 1번만 나가고 새 공간으로 간다', async () => {
  let posts = 0
  const { user, location } = await openCreateDialog({
    handlers: [
      http.post('/api/v1/drive/spaces', async ({ request }) => {
        posts++
        const { name } = (await request.json()) as { name: string }
        return HttpResponse.json({ ...personalSpace, id: NEW_SPACE_ID, type: 'TEAM', name })
      }),
    ],
  })
  await user.type(screen.getByTestId('space-name-input'), '동시생성테스트공간')
  // React 가 다시 그려 disabled 를 반영하기 전에 두 번 — 실제 결함(#582)의 조건.
  // fireEvent 는 act 로 감싸 클릭마다 다시 그리므로(두 번째 클릭이 disabled 에 막힘) 쓰지 않고 원시 이벤트를 연달아 보낸다.
  const confirm = screen.getByTestId('space-name-confirm')
  act(() => {
    confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => expect(location()).toBe(`/drive/spaces/${NEW_SPACE_ID}`))
  expect(posts).toBe(1)
})

test('취소하고 다시 열면 이전 입력값이 남지 않는다', async () => {
  const { user } = await openCreateDialog()
  await user.type(screen.getByTestId('space-name-input'), '임시 테스트 공간')
  await user.click(screen.getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByTestId('space-name-dialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: '팀 공간 만들기' }))
  expect(await screen.findByTestId('space-name-input')).toHaveValue('')
})

test('이미 있는 이름이면 409 메시지를 인라인으로 보이고 대화상자를 유지한다', async () => {
  const { user, location } = await openCreateDialog({
    handlers: [
      http.post('/api/v1/drive/spaces', () =>
        HttpResponse.json({ message: '이미 존재하는 공간 이름입니다: 중복 공간' }, { status: 409 }),
      ),
    ],
  })
  await user.type(screen.getByTestId('space-name-input'), '중복 공간')
  await user.click(screen.getByTestId('space-name-confirm'))
  expect(await screen.findByTestId('space-name-error')).toHaveTextContent('이미 존재하는 공간 이름입니다: 중복 공간')
  expect(screen.getByTestId('space-name-dialog')).toBeInTheDocument()
  expect(location()).not.toBe(`/drive/spaces/${NEW_SPACE_ID}`)
})

test('만든 팀 공간이 사이드바 목록에 나타난다(#148)', async () => {
  const { user, created } = await openCreateDialog({
    handlers: [
      http.post('/api/v1/drive/spaces', async ({ request }) => {
        const { name } = (await request.json()) as { name: string }
        created.space = { ...personalSpace, id: NEW_SPACE_ID, type: 'TEAM', name }
        return HttpResponse.json(created.space, { status: 201 })
      }),
    ],
  })
  await user.type(screen.getByTestId('space-name-input'), '신규팀')
  await user.click(screen.getByTestId('space-name-confirm'))
  expect(await within(screen.getByTestId('drive-space-list')).findByText('신규팀')).toBeInTheDocument()
})

describe('머리말·사용량·공간 목록', () => {
  /** 사이드바만 띄운다 — 공간 목록·쿼터를 준다. */
  function renderSidebar(spaces: DriveSpace[], quota = { usedBytes: 0, quotaBytes: 10_737_418_240 }) {
    return renderScreen(<DriveSidebar />, {
      path: '/drive/spaces/1',
      handlers: [
        http.get('/api/v1/drive/quota', () => HttpResponse.json(quota)),
        http.get('/api/v1/drive/spaces', () => HttpResponse.json(spaces)),
      ],
    })
  }

  // LNB 표준화(#98) — 레일과 같은 「드라이브」 타이틀 헤더(공간 링크 「내 드라이브」와 구분).
  // 채널 연동 공간은 사이드바 어디에도 없다 — 진입은 채널 드로워가 맡는다.
  test('표준 「드라이브」 타이틀이 있고 채널 공간은 노출하지 않는다', async () => {
    renderSidebar([personalSpace, { ...personalSpace, id: 2, type: 'CHANNEL', name: '마케팅', role: 'EDITOR' }])
    const sidebar = screen.getByTestId('drive-sidebar')
    expect(within(sidebar).getByText('드라이브', { exact: true })).toBeInTheDocument()
    expect(await within(screen.getByTestId('drive-space-list')).findByText('내 드라이브')).toBeInTheDocument()
    expect(screen.getByTestId('drive-space-list')).not.toHaveTextContent('마케팅')
    expect(screen.queryByTestId('drive-channel-space-list')).not.toBeInTheDocument()
    expect(sidebar).not.toHaveTextContent('마케팅')
  })

  // #81·#822: 사용량/한도 문구는 모든 구간에서 유지(색만으로 알리지 않음), 막대 색은 <80% 기본 · 80~99% warning · ≥100% destructive(배타),
  // 초과분은 폭 100% 로 클램프.
  const QUOTA = 10_737_418_240
  for (const c of [
    { name: '80% 미만 → 기본색', usedBytes: 2_147_483_648, level: 'normal', cls: 'bg-primary', text: '2.0 GB', width: '20%' },
    { name: '80% 이상 → warning', usedBytes: 9_126_805_504, level: 'warning', cls: 'bg-warning', text: '8.5 GB', width: '85%' },
    { name: '100% 이상 → destructive', usedBytes: 11_811_160_064, level: 'critical', cls: 'bg-destructive', text: '11.0 GB', width: '100%' },
  ]) {
    test(`사용량 바 — ${c.name}`, async () => {
      renderSidebar([personalSpace], { usedBytes: c.usedBytes, quotaBytes: QUOTA })
      const fill = await screen.findByTestId('drive-usage-fill')
      expect(screen.getByTestId('drive-usage-bar')).toBeInTheDocument()
      expect(fill).toHaveAttribute('data-usage-level', c.level)
      expect(fill).toHaveClass(c.cls)
      for (const other of ['bg-primary', 'bg-warning', 'bg-destructive']) if (other !== c.cls) expect(fill).not.toHaveClass(other)
      expect(fill.style.width).toBe(c.width)
      expect(screen.getByTestId('drive-usage-text')).toHaveTextContent(c.text)
      expect(screen.getByTestId('drive-usage-text')).toHaveTextContent('10.0 GB')
    })
  }
})

describe('팀 공간 ⋯ 메뉴', () => {
  const team: DriveSpace = { ...personalSpace, id: 2, type: 'TEAM', name: '기획팀' }

  /** 사이드바(공간 목록: 개인 + 팀) — 테스트별 PATCH/DELETE/멤버 핸들러를 더한다. */
  async function openSpaceMenu(space: DriveSpace, handlers: Parameters<typeof renderScreen>[1] extends infer O ? (O extends { handlers?: infer H } ? NonNullable<H> : never) : never = []) {
    const view = renderScreen(<DriveSidebar />, {
      path: '/drive/spaces/1',
      handlers: [
        ...handlers,
        http.get('/api/v1/drive/quota', () => HttpResponse.json({ usedBytes: 0, quotaBytes: 1024 ** 3 })),
        http.get('/api/v1/drive/spaces', () => HttpResponse.json([personalSpace, space])),
        // 멤버 창이 함께 받는 부서 멤버·조직도(WP-1056) — 부서는 DriveSpaceMemberDialog.test.tsx 가 보고 여기선 비워 둔다.
        http.get(`/api/v1/drive/spaces/${space.id}/member-groups`, () => HttpResponse.json([])),
        http.get('/api/v1/user-groups', () => HttpResponse.json({ shared: [], personal: [] })),
      ],
    })
    await view.user.click(await screen.findByTestId(`drive-space-menu-${space.id}`))
    return view
  }

  // 이름 변경 → PATCH { name }(⋯ 노출 판정은 src/lib/driveSpaces.test.ts).
  test('이름 변경은 PATCH name 을 보내고 목록에 반영된다', async () => {
    const patches: unknown[] = []
    let current = team
    const { user } = await openSpaceMenu(team, [
      http.patch('/api/v1/drive/spaces/2', async ({ request }) => {
        const body = (await request.json()) as { name: string }
        patches.push(body)
        current = { ...team, name: body.name }
        return HttpResponse.json(current)
      }),
      http.get('/api/v1/drive/spaces', () => HttpResponse.json([personalSpace, current])),
    ])
    await user.click(await screen.findByTestId('drive-space-rename-2'))
    const input = await screen.findByTestId('rename-dialog-input')
    await user.clear(input)
    await user.paste('제품팀')
    await user.click(screen.getByTestId('rename-dialog-confirm'))
    await waitFor(() => expect(patches).toEqual([{ name: '제품팀' }]))
    expect(await within(screen.getByTestId('drive-space-list')).findByText('제품팀')).toBeInTheDocument()
  })

  // #696: 다른 팀 공간과 이름이 겹치면 409 — 대화상자를 유지하고(입력 유지) 서버 문구를 인라인으로.
  test('이름이 겹치면(409) 인라인 오류를 보이고 대화상자를 유지한다', async () => {
    const { user } = await openSpaceMenu(team, [
      http.patch('/api/v1/drive/spaces/2', () => HttpResponse.json({ message: '이미 존재하는 공간 이름입니다: 다른팀공간' }, { status: 409 })),
    ])
    await user.click(await screen.findByTestId('drive-space-rename-2'))
    const input = await screen.findByTestId('rename-dialog-input')
    await user.clear(input)
    await user.paste('다른팀공간')
    await user.click(screen.getByTestId('rename-dialog-confirm'))
    expect(await screen.findByTestId('rename-dialog-error')).toHaveTextContent('이미 존재하는 공간 이름입니다: 다른팀공간')
    expect(input).toHaveValue('다른팀공간')
  })

  // 삭제는 공간 이름을 담은 경고 대화상자를 거쳐 DELETE 한다.
  test('삭제는 공간 이름을 보인 경고 뒤 DELETE 한다', async () => {
    let deletes = 0
    const { user } = await openSpaceMenu(team, [
      http.delete('/api/v1/drive/spaces/2', () => {
        deletes++
        return new HttpResponse(null, { status: 204 })
      }),
    ])
    await user.click(await screen.findByTestId('drive-space-delete-2'))
    expect(await screen.findByTestId('drive-space-delete-dialog')).toHaveTextContent('기획팀')
    await user.click(screen.getByTestId('drive-space-delete-confirm'))
    await waitFor(() => expect(deletes).toBe(1))
  })

  // WP-582: 소유자 — ⋯ → 멤버 창: 명단·마지막 소유자 잠금, 추가(POST 편집자)·역할 변경(PATCH)·제거(확인 뒤 DELETE)가 다시 조회돼 반영된다.
  test('소유자는 멤버를 추가·역할 변경·제거하고 목록에 반영된다', async () => {
    const owned: DriveSpace = { ...team, name: '제품기획팀' }
    let members: DriveMember[] = [
      { userId: 1, name: '테스트 사용자', role: 'OWNER' },
      { userId: 3, name: '박서준', role: 'EDITOR' },
    ]
    const calls: { method: string; body: unknown }[] = []
    const { user } = await openSpaceMenu(owned, [
      http.get('/api/v1/drive/spaces/2/members', () => HttpResponse.json(members)),
      http.post('/api/v1/drive/spaces/2/members', async ({ request }) => {
        calls.push({ method: 'POST', body: await request.json() })
        members = [...members, { userId: 2, name: '김민지', role: 'EDITOR' }]
        return new HttpResponse(null, { status: 201 })
      }),
      http.patch('/api/v1/drive/spaces/2/members/3', async ({ request }) => {
        const body = (await request.json()) as { role: DriveMember['role'] }
        calls.push({ method: 'PATCH', body })
        members = members.map((m) => (m.userId === 3 ? { ...m, role: body.role } : m))
        return new HttpResponse(null, { status: 204 })
      }),
      http.delete('/api/v1/drive/spaces/2/members/3', () => {
        calls.push({ method: 'DELETE', body: null })
        members = members.filter((m) => m.userId !== 3)
        return new HttpResponse(null, { status: 204 })
      }),
      http.get('/api/v1/members', () =>
        HttpResponse.json({ content: [createMember({ userId: 2, username: 'minji', name: '김민지' })], page: 0, size: 20, totalElements: 1, totalPages: 1 }),
      ),
    ])
    await user.click(await screen.findByTestId('drive-space-members-2'))
    const dialog = await screen.findByTestId('drive-members-dialog')
    expect(await within(dialog).findByText('멤버 2명')).toBeInTheDocument()
    expect(screen.getByTestId('drive-member-role-select-1')).toBeDisabled()
    expect((screen.getByTestId('drive-member-role-select-3') as HTMLSelectElement).selectedOptions[0]).toHaveTextContent('편집자')

    await user.click(screen.getByTestId('drive-member-add-trigger'))
    // 사람·조직 선택 창(WP-1056) — 사람 후보 행을 고른다.
    await user.click(await screen.findByTestId('drive-member-picker-person-2'))
    expect(await screen.findByTestId('drive-member-row-2')).toHaveTextContent('김민지')
    await user.keyboard('{Escape}')

    await user.selectOptions(screen.getByTestId('drive-member-role-select-3'), 'VIEWER')
    await waitFor(() => expect((screen.getByTestId('drive-member-role-select-3') as HTMLSelectElement).selectedOptions[0]).toHaveTextContent('보기 전용'))

    await user.click(screen.getByTestId('drive-member-remove-3'))
    await user.click(await screen.findByTestId('drive-member-remove-confirm'))
    await waitFor(() => expect(screen.queryByTestId('drive-member-row-3')).not.toBeInTheDocument())
    expect(within(screen.getByTestId('drive-members-dialog')).getByText('멤버 2명')).toBeInTheDocument()
    expect(calls).toEqual([
      { method: 'POST', body: { userId: 2, role: 'EDITOR' } },
      { method: 'PATCH', body: { role: 'VIEWER' } },
      { method: 'DELETE', body: null },
    ])
  })

  // WP-656: 내 행과 공간을 만든 사람의 행은 소유자가 여럿이어도 잠기고, 그 밖의 멤버 행은 바꿀 수 있다.
  test('내 행·생성자 행은 소유자가 여럿이어도 잠긴다', async () => {
    const { user } = await openSpaceMenu({ ...team, ownerId: 4 }, [
      http.get('/api/v1/drive/spaces/2/members', () =>
        HttpResponse.json([
          { userId: 1, name: '테스트 사용자', role: 'OWNER' },
          { userId: 4, name: '정도윤', role: 'OWNER' },
          { userId: 3, name: '박서준', role: 'EDITOR' },
        ]),
      ),
      http.get('/api/v1/members', () => HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 })),
    ])
    await user.click(await screen.findByTestId('drive-space-members-2'))
    expect(await screen.findByTestId('drive-member-role-select-3')).toBeEnabled()
    expect(screen.getByTestId('drive-member-role-select-1')).toBeDisabled()
    expect(screen.getByTestId('drive-member-remove-1')).toBeDisabled()
    expect(screen.getByTestId('drive-member-role-select-4')).toBeDisabled()
    expect(screen.getByTestId('drive-member-remove-4')).toBeDisabled()
  })

  // 소유자가 아닌 멤버 — ⋯ 에는 「멤버」만(이름 변경·삭제 없음), 멤버 창은 명단(역할 배지)만 있고 추가 버튼이 없다.
  test('소유자가 아니면 ⋯ 에 멤버만 있고 멤버 창은 명단만 보인다', async () => {
    const { user } = await openSpaceMenu({ ...team, role: 'EDITOR' }, [
      http.get('/api/v1/drive/spaces/2/members', () =>
        HttpResponse.json([{ userId: 9, name: '김소유', role: 'OWNER' }, { userId: 1, name: '테스트 사용자', role: 'EDITOR' }]),
      ),
    ])
    await screen.findByTestId('drive-space-members-2')
    expect(screen.queryByTestId('drive-space-rename-2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('drive-space-delete-2')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('drive-space-members-2'))
    expect(await screen.findByTestId('drive-member-role-9')).toHaveTextContent('소유자')
    expect(screen.queryByTestId('drive-member-add-trigger')).not.toBeInTheDocument()
  })
})
