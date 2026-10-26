// 설정 › 구성원 목록(/settings/users)과 「구성원 추가」 대화상자 — 화면 컴포넌트 테스트(WP-971, WP-995).
// 추가 폼 → POST payload, 취소 뒤 초기화, 계속 추가, 같은 틱 두 번 클릭 1회 요청, 서버 필드 오류 우선, zod 아이디 규칙,
// SSO 켜짐/꺼짐에 따른 로그인 방식, 아이디·이메일 보조 줄, 다음 페이지 실패 → 다시 시도는 브라우저 없이 판정되므로
// e2e/pages/admin/member-add.spec.ts · member-add-sso.spec.ts · settings-list-infinite-scroll.spec.ts 에서 옮겼다.
// 설정 사이드바의 워크스페이스 관리 항목 순서(admin-sidebar.spec.ts)도 여기서 본다 — 구성원 화면 옆에 놓이는 사이드바라 한 파일에 모았다.
// E2E 에 남는 것: 구분 배지 배선(user-list-kind.spec.ts @wiring), 스크롤로 다음 페이지 이어 붙이기(@layout).
// 대화상자·푸터가 목록 화면 안에 있어 UserListPage 를 renderScreen 으로 띄운다(앱 셸·라우트는 거치지 않는다).
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { SettingsSidebar } from '@/components/layout/SettingsSidebar'
import { renderScreen } from '@/test/renderScreen'

import { createMember } from '../../../e2e/factories/auth.factory'
import { createPageResponse } from '../../../e2e/fixtures/api-mock'
import UserListPage from './UserListPage'

const sso = (enabled: boolean) => ({ available: true, enabled, adminConsentUrl: null, passwordlessMemberCount: 0 })

const created = (n: number) => ({
  userId: n,
  username: `user${n}`,
  name: `사용자${n}`,
  email: null,
  role: 'USER',
  status: 'ACTIVE',
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * 목록(빈 페이지)·SSO 설정·구성원 생성 API. POST 본문은 posts 에 모은다.
 * postResponse 로 응답을 바꾼다(기본 201). delayMs 는 경합 재현용 지연.
 */
function memberApi(opts: { ssoEnabled?: boolean; postResponse?: () => Response; delayMs?: number } = {}) {
  const posts: unknown[] = []
  const handlers = [
    http.get('/api/v1/members', () => HttpResponse.json(createPageResponse([]))),
    http.get('/api/v1/admin/sso', () => HttpResponse.json(sso(opts.ssoEnabled ?? false))),
    http.post('/api/v1/users', async ({ request }) => {
      posts.push(await request.json())
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
      return opts.postResponse ? opts.postResponse() : HttpResponse.json(created(posts.length), { status: 201 })
    }),
  ]
  return { posts, handlers }
}

/** 목록을 띄우고 「구성원 추가」 대화상자를 연다. */
async function openAddDialog(opts: Parameters<typeof memberApi>[0] = {}) {
  const api = memberApi(opts)
  const view = renderScreen(<UserListPage />, { path: '/settings/users', handlers: api.handlers })
  await view.user.click(await screen.findByRole('button', { name: '구성원 추가' }))
  await screen.findByTestId('add-member-submit')
  return { ...view, posts: api.posts }
}

type User = ReturnType<typeof renderScreen>['user']

/** 칸에 값을 붙여 넣는다(키 하나하나는 의미가 없다). */
async function fill(user: User, testId: string, value: string) {
  await user.click(screen.getByTestId(testId))
  await user.paste(value)
}

/** 비밀번호 구성원 기본 입력 — 아이디·이름·비밀번호. */
async function fillMember(user: User, username: string, name: string) {
  await fill(user, 'add-member-username', username)
  await fill(user, 'add-member-name', name)
  await fill(user, 'add-member-password', 'Password123')
}

test('구성원 추가 — 아이디·이메일·이름·역할이 그대로 전송되고 대화상자가 닫힌다', async () => {
  const { user, posts } = await openAddDialog()
  await fill(user, 'add-member-username', 'jane@acme.com')
  await fill(user, 'add-member-email', 'jane@acme.com')
  await fill(user, 'add-member-name', '김제인')
  await fill(user, 'add-member-password', 'Password123')
  await user.click(screen.getByTestId('add-member-submit'))

  await waitFor(() => expect(screen.queryByTestId('add-member-submit')).not.toBeInTheDocument())
  expect(posts).toHaveLength(1)
  expect(posts[0]).toMatchObject({ username: 'jane@acme.com', email: 'jane@acme.com', name: '김제인', role: 'USER' })
})

test('취소하고 다시 열면 이전 입력값·역할 선택이 남지 않는다', async () => {
  const { user } = await openAddDialog()
  await fill(user, 'add-member-username', 'leftover@acme.com')
  await fill(user, 'add-member-email', 'leftover@acme.com')
  await fill(user, 'add-member-name', '잔여값')
  await fill(user, 'add-member-password', 'Password123')
  await user.click(screen.getByTestId('add-member-role-admin'))
  await user.click(screen.getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByTestId('add-member-submit')).not.toBeInTheDocument())

  await user.click(screen.getByRole('button', { name: '구성원 추가' }))
  expect(await screen.findByTestId('add-member-username')).toHaveValue('')
  expect(screen.getByTestId('add-member-email')).toHaveValue('')
  expect(screen.getByTestId('add-member-name')).toHaveValue('')
  expect(screen.getByTestId('add-member-password')).toHaveValue('')
  expect(screen.getByTestId('add-member-role-user')).toBeChecked()
})

test('계속 추가를 켜면 저장해도 대화상자가 남고 폼만 비워져, 두 번째 구성원도 이어서 추가된다 (#593)', async () => {
  const { user, posts } = await openAddDialog()
  await user.click(screen.getByTestId('add-member-keep-open'))

  await fillMember(user, 'user1@acme.com', '사용자1')
  await user.click(screen.getByTestId('add-member-submit'))
  await waitFor(() => expect(posts).toHaveLength(1))
  await waitFor(() => expect(screen.getByTestId('add-member-username')).toHaveValue(''))
  expect(screen.getByTestId('add-member-name')).toHaveValue('')
  expect(screen.getByTestId('add-member-password')).toHaveValue('')
  // 체크박스가 form reset 에 반응해 풀리던 결함 — 체크가 남아 있어야 두 번째 저장에도 닫히지 않는다.
  expect(screen.getByTestId('add-member-keep-open')).toBeChecked()

  await fillMember(user, 'user2@acme.com', '사용자2')
  await user.click(screen.getByTestId('add-member-submit'))
  await waitFor(() => expect(posts).toHaveLength(2))
  await waitFor(() => expect(screen.getByTestId('add-member-username')).toHaveValue(''))
  expect(screen.getByTestId('add-member-submit')).toBeInTheDocument()
})

test('추가 버튼을 같은 틱에 두 번 눌러도 생성 요청은 1번만 나간다 (#583)', async () => {
  const { user, posts } = await openAddDialog({ delayMs: 100 })
  await fillMember(user, 'dupe@acme.com', '중복테스트')
  // isPending 리렌더 전 두 번째 클릭 — fireEvent 는 클릭마다 다시 그려 disabled 에 막히므로 원시 이벤트를 연달아 보낸다.
  const submit = screen.getByTestId('add-member-submit')
  act(() => {
    submit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    submit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  await waitFor(() => expect(screen.queryByTestId('add-member-submit')).not.toBeInTheDocument())
  expect(posts).toHaveLength(1)
})

test('서버 검증 오류는 최상위 message 대신 errors 필드 맵의 메시지를 보인다 (#580)', async () => {
  const { user } = await openAddDialog({
    postResponse: () =>
      HttpResponse.json(
        { message: 'Validation failed', errors: { username: '아이디는 공백일 수 없습니다.' } },
        { status: 400 },
      ),
  })
  await fillMember(user, 'validlookingbutrejected@acme.com', '테스트')
  await user.click(screen.getByTestId('add-member-submit'))

  expect(await screen.findByTestId('add-member-error')).toHaveTextContent('아이디는 공백일 수 없습니다.')
  expect(screen.getByTestId('add-member-error')).not.toHaveTextContent('Validation failed')
})

test('비밀번호 구성원도 이메일이 아닌 아이디는 클라이언트 검증에서 막혀 전송되지 않는다 (WP-181)', async () => {
  const { user, posts } = await openAddDialog()
  await fillMember(user, 'max.lee', '맥스')
  await user.click(screen.getByTestId('add-member-submit'))

  expect(await screen.findByText('아이디는 이메일 형식이어야 합니다')).toBeInTheDocument()
  expect(posts).toEqual([])
})

test('SSO 가 켜져 있으면 SSO 전용이 기본이고, 비밀번호 없이 아이디·이름·역할만 보낸다 (WP-48)', async () => {
  const { user, posts } = await openAddDialog({ ssoEnabled: true })
  expect(await screen.findByLabelText('SSO 전용 (비밀번호 없음)')).toBeChecked()
  expect(screen.queryByTestId('add-member-password')).not.toBeInTheDocument()
  expect(screen.getByText('회사 계정 주소(이메일)를 입력하세요.')).toBeInTheDocument()

  await fill(user, 'add-member-username', 'hong@acme.com')
  await fill(user, 'add-member-name', '홍')
  await user.click(screen.getByTestId('add-member-submit'))

  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0]).toEqual({ username: 'hong@acme.com', name: '홍', role: 'USER' })
})

test('SSO 가 꺼져 있으면 로그인 방식 선택이 없고 비밀번호 칸이 보인다', async () => {
  await openAddDialog({ ssoEnabled: false })
  expect(screen.queryByText('로그인 방식')).not.toBeInTheDocument()
  expect(screen.getByTestId('add-member-password')).toBeInTheDocument()
})

test('아이디는 이름 아래 보조 줄에 보이고, 이메일은 아이디와 다를 때만 덧붙는다 (WP-182)', async () => {
  renderScreen(<UserListPage />, {
    path: '/settings/users',
    handlers: [
      http.get('/api/v1/members', () =>
        HttpResponse.json(
          createPageResponse([
            createMember({ userId: 1, name: '같은값', username: 'same@example.com', email: 'same@example.com' }),
            createMember({ userId: 2, name: '다른값', username: 'diff', email: 'diff@example.com' }),
          ]),
        ),
      ),
    ],
  })
  const same = await screen.findByRole('button', { name: '사용자 같은값 상세 보기' })
  // 아이디·이메일 별도 열은 없다.
  expect(screen.queryByRole('columnheader', { name: '아이디' })).not.toBeInTheDocument()
  expect(screen.queryByRole('columnheader', { name: '이메일' })).not.toBeInTheDocument()
  expect(within(same).getByTestId('user-list-username')).toHaveTextContent(/^same@example\.com$/)
  const diff = screen.getByRole('button', { name: '사용자 다른값 상세 보기' })
  expect(within(diff).getByTestId('user-list-username')).toHaveTextContent('diff · diff@example.com')
})

test('다음 페이지가 실패하면 받은 행은 남고 「다시 시도」가 나오며, 자동 로드는 멈추고 누르면 이어 붙는다 (WP-182)', async () => {
  // 교차는 레이아웃이라 jsdom 이 재지 못한다 — sentinel 이 보였다고 테스트가 직접 알린다(스크롤 자체는 E2E @layout).
  const observers: Array<{ cb: IntersectionObserverCallback; nodes: Element[] }> = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private entry: { cb: IntersectionObserverCallback; nodes: Element[] }
      constructor(cb: IntersectionObserverCallback) {
        this.entry = { cb, nodes: [] }
        observers.push(this.entry)
      }
      observe(node: Element) {
        this.entry.nodes.push(node)
      }
      unobserve() {}
      disconnect() {
        this.entry.nodes = []
      }
      takeRecords() {
        return []
      }
    },
  )
  /** 지금 붙어 있는 sentinel 들에 「화면에 들어옴」을 보낸다. */
  const intersect = () =>
    act(() => {
      for (const o of observers)
        for (const target of o.nodes)
          o.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], {} as IntersectionObserver)
    })

  const members = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) =>
      createMember({ userId: from + i, name: `구성원 ${from + i}`, username: `user${from + i}@example.com`, email: `user${from + i}@example.com` }),
    )
  const pages = [members(1, 50), members(1001, 2)]
  let allowSecond = false
  let secondRequests = 0
  const { user } = renderScreen(<UserListPage />, {
    path: '/settings/users',
    handlers: [
      http.get('/api/v1/members', ({ request }) => {
        const n = Number(new URL(request.url).searchParams.get('page') ?? 0)
        if (n === 1) {
          secondRequests += 1
          if (!allowSecond) return HttpResponse.json({}, { status: 500 })
        }
        return HttpResponse.json(createPageResponse(pages[n] ?? [], { page: n, size: 50, totalElements: 52, totalPages: 2 }))
      }),
    ],
  })
  await screen.findByRole('button', { name: '사용자 구성원 1 상세 보기' })
  expect(screen.getByTestId('user-list-total')).toHaveTextContent('총 52명')
  // 페이지 번호 버튼(1·2…) 대신 무한 스크롤.
  expect(screen.queryByRole('button', { name: '2' })).not.toBeInTheDocument()

  intersect()
  const retry = await screen.findByRole('button', { name: '불러오지 못했습니다 — 다시 시도' })
  // 다음 페이지 실패가 이미 받은 행을 오류 화면으로 덮지 않는다(첫 페이지 실패만 오류 행).
  expect(screen.getByRole('button', { name: '사용자 구성원 1 상세 보기' })).toBeInTheDocument()
  expect(screen.queryByText('데이터를 불러오는데 실패했습니다.')).not.toBeInTheDocument()
  // 실패 뒤엔 sentinel 이 다시 보여도 요청을 다시 보내지 않는다(실패 요청 무한 반복 방지).
  expect(secondRequests).toBe(1)
  intersect()
  expect(secondRequests).toBe(1)

  allowSecond = true
  await user.click(retry)
  expect(await screen.findByRole('button', { name: '사용자 구성원 1002 상세 보기' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '불러오지 못했습니다 — 다시 시도' })).not.toBeInTheDocument()
})


test('설정 사이드바 워크스페이스 관리 그룹은 구성원 → 에이전트 → 역할 → SSO → 감사 로그 순이다', async () => {
  // 관리자에게만 그려지는 그룹 — 노트 공유는 WP-887 에서 「앱 설정 › 노트」로 옮겼다.
  renderScreen(<SettingsSidebar />, { path: '/settings/users', auth: { isAdmin: true } })
  const group = await screen.findByTestId('settings-admin-group')
  expect(within(group).getAllByRole('link').map((link) => link.textContent?.trim())).toEqual([
    '구성원',
    '에이전트',
    '역할',
    'SSO',
    '감사 로그',
  ])
})
