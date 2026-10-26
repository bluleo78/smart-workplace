// 데스크톱 앱 레일(AppRail)과 그 하단 묶음(워크스페이스 스위처·알림 인박스·사용자 메뉴의 「새 소식」) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 레일 항목 순서·접근 가능한 이름·펼치기/접기·안 읽음 배지, 스위처의 지연 조회·전환·비활성, 「새 소식」 메뉴·창·안 읽음 점,
// 인박스 배지·목록 문구·에이전트 배지·빈 상태·읽음 요청·이동 주소·모두 읽음·다음 페이지 이어 붙이기는 브라우저 없이 판정되므로
// e2e/pages/app-rail.spec.ts · workspace-switcher.spec.ts · whats-new.spec.ts · inbox.spec.ts 에서 옮겼다.
// 그 spec 들에는 실제 기하(@layout)·호버 툴팁·포커스(@input)·새로고침 유지(@platform)·화면 배선(@wiring)·여러 화면 흐름(@flow)만 남는다.
// App 전체(renderPage) 대신 레일만 AppLayout 과 같은 Provider(AI 어시스턴트·인박스)로 감싸 renderScreen 으로 띄운다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { AppRail } from '@/components/layout/AppRail'
import { InboxProvider } from '@/components/layout/InboxContext'
import { WHATS_NEW_STORAGE_KEY } from '@/lib/releaseNotes'
import { renderScreen } from '@/test/renderScreen'
import type { Membership } from '@/types/auth'
import type { NotificationResponse } from '@/types/notification'

import { createMembership } from '../../../e2e/factories/auth.factory'
import { createChannel, createDm } from '../../../e2e/factories/messaging.factory'

// 「새 소식」 노트 — E2E 픽스처(e2e/fixtures/releases)와 같은 세 개. vitest 빌드 버전은 'dev' 라 가장 높은 공개 노트(0.9.0)가 현재 노트가 된다.
// 0.9.1 은 숨김이라 어디에도 보이지 않아야 한다.
vi.mock('@/lib/releaseNotesBundle', () => ({
  loadBundledNotes: () => [
    { version: '0.8.0', date: '2026-09-20', body: '## 메일\n- 이전 기능', hidden: false },
    { version: '0.9.0', date: '2026-10-10', body: '## 드라이브\n- 한글 문서를 바로 미리볼 수 있습니다', hidden: false },
    { version: '0.9.1', date: '2026-10-17', body: '## 숨김\n- 아직 공개하지 않는 노트', hidden: true },
  ],
}))

const TENANT_A = createMembership({ tenantId: 1, tenantName: '에이콘 워크스페이스', tenantSlug: 'acorn' })
const TENANT_B = createMembership({ tenantId: 2, tenantName: '베타 워크스페이스', tenantSlug: 'beta' })

type Counts = { channels?: ReturnType<typeof createChannel>[]; dms?: ReturnType<typeof createDm>[]; mail?: number; inbox?: number }

/** 레일이 늘 부르는 안 읽음 조회(대화·메일·인박스) — 기본은 모두 0. */
function railHandlers({ channels = [], dms = [], mail = 0, inbox = 0 }: Counts = {}) {
  return [
    http.get('/api/v1/messaging/channels', () => HttpResponse.json(channels)),
    http.get('/api/v1/messaging/dms', () => HttpResponse.json(dms)),
    http.get('/api/v1/mail/unread-summary', () => HttpResponse.json({ workUnread: mail })),
    http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count: inbox })),
    // 인박스 목록 위 푸시 안내가 서버 푸시 설정을 묻는다 — 꺼진 서버로 둔다.
    http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: false, vapidPublicKey: null })),
  ]
}

/** AppLayout 과 같은 Provider 로 레일을 감싼다(AI 어시스턴트 모드·인박스 열림 상태). */
function Shell({ children }: { children: ReactNode }) {
  return (
    <AIAssistantProvider hotkeysEnabled={false}>
      <InboxProvider>{children}</InboxProvider>
    </AIAssistantProvider>
  )
}

type Options = Counts & {
  handlers?: RequestHandler[]
  activeTenant?: Membership | null
  selectTenant?: (m: Membership) => Promise<void>
}

/** 홈('/')에서 레일을 띄운다. 기본 로그인 사용자는 활성 테넌트가 없다(E2E 기본 fixture 와 같음 — 스위처 미렌더). */
function renderRail({ handlers = [], activeTenant = null, selectTenant, ...counts }: Options = {}) {
  return renderScreen(
    <Shell>
      <AppRail />
    </Shell>,
    {
      path: '/',
      handlers: [...handlers, ...railHandlers(counts)],
      auth: { activeTenant, ...(selectTenant ? { selectTenant } : {}) },
    },
  )
}

describe('레일 항목', () => {
  // #98·#99·#477 — 한글 라벨과 소통 우선 순서. 순서가 바뀌면 사용자가 익힌 위치가 흔들린다.
  test('한글 라벨과 소통 우선 순서(홈·대화·메일·캘린더·작업관리·드라이브·노트·연락처·설정)', async () => {
    renderRail()
    const rail = await screen.findByTestId('app-rail')
    expect(screen.getByTestId('rail-link-/chat')).toHaveTextContent('대화')
    expect(screen.getByTestId('rail-link-/drive')).toHaveTextContent('드라이브')
    const order = Array.from(rail.querySelectorAll('[data-testid^="rail-link-"]')).map((e) => e.getAttribute('data-testid'))
    expect(order).toEqual([
      'rail-link-/',
      'rail-link-/chat',
      'rail-link-/mail',
      'rail-link-/calendar',
      'rail-link-/projects',
      'rail-link-/drive',
      'rail-link-/wiki',
      'rail-link-/contacts',
      'rail-link-/settings/profile',
    ])
  })

  // #120 — 데스크톱에선 라벨 span 이 CSS 로 숨어 링크 이름이 비던 결함. 숨김이 이름에 미치는 영향은 jsdom 이 잴 수 없어
  // app-rail.spec.ts 의 @layout 이 실제 브라우저에서 보고, 여기서는 이름이 라벨 글자가 아니라 aria-label 로 고정돼 있는지 본다.
  test('모듈 링크 9개가 aria-label 로 고정된 이름을 갖고, 이름 없는 링크가 없다', async () => {
    renderRail()
    const nav = within(await screen.findByTestId('app-rail')).getByRole('navigation')
    for (const name of ['홈', '작업 관리', '대화', '메일', '연락처', '캘린더', '드라이브', '노트', '설정']) {
      expect(within(nav).getByRole('link', { name })).toHaveAttribute('aria-label', name)
    }
    expect(within(nav).getAllByRole('link')).toHaveLength(9)
    // 홈('/')에선 홈 링크만 현재 위치다.
    expect(within(nav).getByRole('link', { name: '홈' })).toHaveAttribute('aria-current', 'page')
    expect(nav.querySelectorAll('a[aria-current="page"]')).toHaveLength(1)
  })

  // #471 — 브랜드 마크 = 펼치기 토글, 펼친 뒤엔 로고 = 접기 토글(별도 버튼 없음). 상태는 localStorage 로 남긴다.
  test('마크를 누르면 펼쳐지고(접기 토글로 바뀜), 로고를 누르면 다시 접힌다', async () => {
    const { user } = renderRail()
    const toggle = await screen.findByTestId('rail-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAccessibleName('사이드바 펼치기')
    // 워드마크(Works)의 숨김·노출은 CSS(lg:hidden) 라 jsdom 이 잴 수 없다 — app-rail.spec.ts 의 @layout 이 본다.

    await user.click(toggle)
    expect(screen.queryByTestId('rail-toggle')).not.toBeInTheDocument()
    const collapse = screen.getByTestId('rail-collapse')
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(collapse).toHaveAccessibleName('사이드바 접기')
    expect(window.localStorage.getItem('app-rail-expanded')).toBe('true')

    await user.click(collapse)
    expect(await screen.findByTestId('rail-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(window.localStorage.getItem('app-rail-expanded')).toBe('false')
  })

  // #471 — 레일 헤더(첫 border-b 블록)에는 브랜드 토글만 있고 워크스페이스 스위처는 하단 푸터에 있다.
  test('헤더엔 브랜드 토글만, 워크스페이스 스위처는 헤더가 아니라 하단에 있다', async () => {
    renderRail({ activeTenant: TENANT_A })
    const rail = await screen.findByTestId('app-rail')
    const header = rail.querySelector('div.border-b') as HTMLElement
    expect(within(header).getByTestId('rail-toggle')).toBeInTheDocument()
    expect(within(header).queryByTestId('workspace-switcher')).not.toBeInTheDocument()
    expect(within(rail.querySelector('div.border-t') as HTMLElement).getByTestId('workspace-switcher')).toBeInTheDocument()
  })

  // WP-796 — 대화(채널+DM 합)·메일(업무 안 읽음) 배지. 축소 레일에선 링크 이름에 수가 담긴다. 배지 없는 앱엔 그리지 않는다.
  test('대화·메일 안 읽음 배지와 링크 이름에 수가 담기고, 펼쳐도 배지가 남는다', async () => {
    const { user } = renderRail({
      channels: [createChannel({ id: 1, unreadCount: 2 })],
      dms: [createDm({ id: 2, unreadCount: 3 })],
      mail: 4,
    })
    expect(await screen.findByTestId('rail-badge-/chat')).toHaveTextContent('5')
    expect(await screen.findByTestId('rail-badge-/mail')).toHaveTextContent('4')
    expect(screen.queryByTestId('rail-badge-/calendar')).not.toBeInTheDocument()
    expect(screen.getByTestId('rail-link-/chat')).toHaveAttribute('aria-label', '대화, 읽지 않음 5')
    expect(screen.getByTestId('rail-link-/mail')).toHaveAttribute('aria-label', '메일, 업무 메일 안 읽음 4')

    await user.click(screen.getByTestId('rail-toggle'))
    expect(screen.getByTestId('rail-badge-/chat')).toHaveTextContent('5')
  })

  // 조회가 끝나기 전 기본값 0 으로 거짓 통과하지 않도록, 응답이 도착한 뒤(요청을 받은 뒤)에 배지 부재를 본다.
  test('안 읽은 것이 없으면 대화·메일 배지가 없고 이름에 수가 붙지 않는다', async () => {
    const seen = { channels: false, mail: false }
    renderRail({
      handlers: [
        http.get('/api/v1/messaging/channels', () => {
          seen.channels = true
          return HttpResponse.json([createChannel({ id: 1, unreadCount: 0 })])
        }),
        http.get('/api/v1/mail/unread-summary', () => {
          seen.mail = true
          return HttpResponse.json({ workUnread: 0 })
        }),
      ],
    })
    await waitFor(() => expect(seen).toEqual({ channels: true, mail: true }))
    await act(() => new Promise((r) => setTimeout(r, 0)))
    expect(screen.queryByTestId('rail-badge-/chat')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rail-badge-/mail')).not.toBeInTheDocument()
    expect(screen.getByTestId('rail-link-/chat')).toHaveAttribute('aria-label', '대화')
  })
})

describe('워크스페이스 스위처', () => {
  /** 멤버십 조회 — 요청 횟수를 센다. */
  function memberships(list: Membership[]) {
    const calls = { count: 0 }
    return { calls, handler: http.get('/api/v1/auth/memberships', () => (calls.count++, HttpResponse.json(list))) }
  }

  // 활성 테넌트가 없으면 칩을 그리지 않고, 있으면 접근 가능한 이름으로 보인다.
  test('활성 테넌트가 있을 때만 칩이 「워크스페이스 전환」 이름으로 보인다', async () => {
    const { unmount } = renderRail()
    await screen.findByTestId('app-rail')
    expect(screen.queryByTestId('workspace-switcher')).not.toBeInTheDocument()
    unmount()

    renderRail({ activeTenant: TENANT_A })
    expect(await screen.findByTestId('workspace-switcher')).toHaveAttribute('aria-label', '워크스페이스 전환')
  })

  // #219 — 레일이 그려지기만 해서는 멤버십을 부르지 않고, 칩을 열 때 한 번만 부른다.
  test('팝오버를 열기 전에는 멤버십을 조회하지 않고, 열면 1회 조회해 두 워크스페이스를 보인다', async () => {
    const m = memberships([TENANT_A, TENANT_B])
    const { user } = renderRail({ activeTenant: TENANT_A, handlers: [m.handler] })
    await user.click(await screen.findByTestId('workspace-switcher').then((el) => (expect(m.calls.count).toBe(0), el)))
    expect(await screen.findByTestId('workspace-switch-1')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-switch-2')).toHaveTextContent('베타 워크스페이스')
    expect(m.calls.count).toBe(1)
  })

  // 현재 워크스페이스는 비활성이고, 다른 워크스페이스를 고르면 그 멤버십으로 전환한다(select-tenant payload 는 authPages.test.tsx 가 본다).
  test('현재 워크스페이스는 비활성, 다른 워크스페이스를 고르면 그 멤버십으로 전환한다', async () => {
    const selectTenant = vi.fn(async () => {})
    const { user } = renderRail({ activeTenant: TENANT_A, selectTenant, handlers: [memberships([TENANT_A, TENANT_B]).handler] })
    await user.click(await screen.findByTestId('workspace-switcher'))
    expect(await screen.findByTestId('workspace-switch-1')).toHaveAttribute('data-disabled')
    await user.click(screen.getByTestId('workspace-switch-2'))
    expect(selectTenant).toHaveBeenCalledTimes(1)
    expect(selectTenant).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 2 }))
  })

  // 전환할 다른 워크스페이스가 없으면(목록 1개) 표시 전용 — 그 하나가 현재 워크스페이스가 아니어도(경합 직후 등) 고를 수 없다.
  // 현재 워크스페이스는 어차피 비활성이라, 현재가 아닌 하나로 「목록 1개면 비활성」 규칙만 따로 본다.
  test('멤버십이 1개뿐이면 전환 항목이 비활성(표시 전용)이다', async () => {
    const selectTenant = vi.fn(async () => {})
    const { user } = renderRail({ activeTenant: TENANT_A, selectTenant, handlers: [memberships([TENANT_B]).handler] })
    await user.click(await screen.findByTestId('workspace-switcher'))
    expect(await screen.findByTestId('workspace-switch-2')).toHaveAttribute('data-disabled')
    await user.click(screen.getByTestId('workspace-switch-2'))
    expect(selectTenant).not.toHaveBeenCalled()
  })
})

describe('사용자 메뉴 — 새 소식(WP-439)', () => {
  // 메뉴 순서는 사용자가 익힌 위치 — 프로필 → 새 소식 → 테마 전환 → 로그아웃.
  test('첫 방문이면 아바타·항목에 점이 있고, 메뉴 순서는 프로필 → 새 소식 → 테마 전환 → 로그아웃', async () => {
    const { user } = renderRail()
    expect(await screen.findByTestId('rail-user-avatar-dot')).toBeInTheDocument()
    await user.click(screen.getByTestId('rail-user-menu'))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((e) => e.textContent?.trim() ?? '')).toEqual([
      expect.stringContaining('프로필'),
      expect.stringContaining('새 소식'),
      expect.stringContaining('테마 전환'),
      expect.stringContaining('로그아웃'),
    ])
    expect(within(screen.getByTestId('whats-new-menu-item')).getByTestId('whats-new-dot')).toBeInTheDocument()
  })

  // 현재 노트 본문·날짜, 접힌 이전 소식(펼치면 보임), 숨김 노트는 어디에도 없다. 열면 확인 처리돼 점이 바로 꺼진다.
  test('새 소식 창 — 현재 노트와 접힌 이전 소식을 보이고 숨김 노트는 없으며, 열면 점이 꺼지고 확인 버전을 남긴다', async () => {
    const { user } = renderRail()
    await user.click(await screen.findByTestId('rail-user-menu'))
    await user.click(await screen.findByTestId('whats-new-menu-item'))
    const dialog = await screen.findByTestId('whats-new-dialog')
    expect(dialog).toHaveTextContent('한글 문서를 바로 미리볼 수 있습니다')
    expect(dialog).toHaveTextContent('2026-10-10')
    expect(within(dialog).queryByText('이전 기능')).not.toBeInTheDocument()
    await user.click(within(dialog).getByTestId('whats-new-previous-0.8.0'))
    expect(within(dialog).getByText('이전 기능')).toBeInTheDocument()
    expect(within(dialog).queryByTestId('whats-new-previous-0.9.1')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('아직 공개하지 않는 노트')).not.toBeInTheDocument()

    expect(screen.queryByTestId('rail-user-avatar-dot')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(WHATS_NEW_STORAGE_KEY)).toBe('0.9.0')
  })

  test('이미 현재 버전을 본 브라우저는 처음부터 아바타·항목에 점이 없다', async () => {
    window.localStorage.setItem(WHATS_NEW_STORAGE_KEY, '0.9.0')
    const { user } = renderRail()
    await user.click(await screen.findByTestId('rail-user-menu'))
    expect(await screen.findByTestId('whats-new-menu-item')).toBeInTheDocument()
    expect(screen.queryByTestId('whats-new-dot')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rail-user-avatar-dot')).not.toBeInTheDocument()
  })
})

// ─── 알림 인박스 ───

/** 알림 1건 — e2e/pages/inbox.spec.ts 와 같은 기본값(이름에 AI 가 없는 AGENT 의 코멘트). */
function notif(over: Partial<NotificationResponse> = {}): NotificationResponse {
  return {
    id: 1,
    type: 'COMMENTED',
    actorId: 9,
    actorName: 'AI 동료',
    actorKind: 'AGENT',
    issueId: 7,
    projectKey: 'WP',
    issueNumber: 3,
    issueTitle: '리팩터링',
    commentId: 55,
    eventId: null,
    eventTitle: null,
    eventStartsAt: null,
    read: false,
    createdAt: new Date().toISOString(),
    ...over,
  }
}

/** 인박스를 열고 행이 그려질 때까지 기다린다. reads 는 읽음 POST 를 받은 알림 id 목록. */
async function openInbox(list: NotificationResponse[] | ((offset: string | null) => NotificationResponse[]), unread = 1) {
  const reads: number[] = []
  const readAll = { count: 0 }
  const view = renderRail({
    inbox: unread,
    handlers: [
      http.get('/api/v1/notifications', ({ request }) => {
        const offset = new URL(request.url).searchParams.get('offset')
        return HttpResponse.json(typeof list === 'function' ? list(offset) : list)
      }),
      http.post('/api/v1/notifications/:id/read', ({ params }) => {
        reads.push(Number(params.id))
        return new HttpResponse(null, { status: 204 })
      }),
      http.post('/api/v1/notifications/read-all', () => {
        readAll.count++
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  })
  await view.user.click(await screen.findByTestId('inbox-trigger'))
  const panel = await screen.findByTestId('inbox-panel')
  return { ...view, panel, reads, readAll }
}

describe('알림 인박스', () => {
  test('안 읽은 수가 종 배지로 보인다', async () => {
    renderRail({ inbox: 3 })
    expect(await screen.findByTestId('inbox-badge')).toHaveTextContent('3')
  })

  // #698 — 패널은 「알림」 이름의 대화상자. WP-935 — AGENT 행위자에는 공용 에이전트 배지(Bot + 「에이전트」, ai-accent 토큰).
  test('패널을 열면 목록을 보이고 「알림」 이름을 가지며, AI 행위자에 에이전트 배지를 단다', async () => {
    const { panel } = await openInbox([notif({ actorName: '업무 비서' })])
    expect(panel).toHaveAttribute('aria-label', '알림')
    const item = (await screen.findAllByTestId('inbox-item'))[0]
    expect(item).toHaveTextContent('업무 비서')
    expect(item).toHaveTextContent('WP-3 리팩터링')
    const badge = within(item).getByTestId('agent-badge')
    expect(badge).toHaveTextContent('에이전트')
    expect(badge.className).toMatch(/bg-ai-accent-subtle/)
  })

  // #636·WP-935 — 이름에 "AI" 가 있어도 배지를 달고, 예전 「AI」 글자 칩은 없다(「AI AI」 중복 없음).
  test('액터 이름에 "AI" 가 있어도 에이전트 배지를 달고 「AI」 글자 칩은 없다', async () => {
    await openInbox([notif({ actorName: 'My AI', actorKind: 'AGENT' })])
    const item = (await screen.findAllByTestId('inbox-item'))[0]
    expect(item).toHaveTextContent('My AI')
    expect(within(item).getByTestId('agent-badge')).toHaveTextContent('에이전트')
    expect(within(item).queryByText('AI', { exact: true })).not.toBeInTheDocument()
  })

  // 디자인 시스템 §2.5 — 아이콘 + 제목 + 설명. #186 — 알림이 없으면 「모두 읽음」이 비활성.
  test('빈 목록은 아이콘·제목·설명의 빈 상태를 보이고 「모두 읽음」이 비활성이다', async () => {
    await openInbox([], 0)
    const empty = await screen.findByTestId('inbox-empty')
    expect(empty).toHaveTextContent('새 알림이 없습니다')
    expect(empty).toHaveTextContent('이슈 배정, 코멘트, 상태 변경 알림이 여기에 표시됩니다.')
    expect(empty.querySelector('svg')).not.toBeNull()
    expect(screen.getByTestId('inbox-mark-all')).toBeDisabled()
  })

  test('읽은 알림만 있으면(안 읽음 0) 「모두 읽음」이 비활성이다', async () => {
    await openInbox([notif({ read: true })], 0)
    await screen.findAllByTestId('inbox-item')
    expect(screen.getByTestId('inbox-mark-all')).toBeDisabled()
  })

  test('「모두 읽음」을 누르면 read-all 을 요청한다', async () => {
    const { user, readAll } = await openInbox([notif()])
    await screen.findAllByTestId('inbox-item')
    await waitFor(() => expect(screen.getByTestId('inbox-mark-all')).toBeEnabled())
    await user.click(screen.getByTestId('inbox-mark-all'))
    await waitFor(() => expect(readAll.count).toBe(1))
  })

  // 행 클릭 → 그 알림만 읽음 처리하고 이슈 상세로 간다.
  test('행을 누르면 읽음 요청 후 이슈 상세로 간다', async () => {
    const { user, reads, location } = await openInbox([notif()])
    await user.click((await screen.findAllByTestId('inbox-item'))[0])
    await waitFor(() => expect(reads).toEqual([1]))
    expect(location()).toBe('/projects/WP/issues/3')
  })

  // #613 — 우선순위 변경은 상태 변경과 같은 꼴의 문구. WP-869 — 상태 변경은 새 상태 이름을 받침에 맞는 조사로 싣고, 이름이 없으면 기존 문구.
  test('우선순위·상태 변경 알림 문구 — 새 상태 이름이 있으면 싣는다', async () => {
    const { user, location } = await openInbox(
      [
        notif({ id: 4, type: 'PRIORITY_CHANGED', actorId: 2, actorName: '양동희', actorKind: 'HUMAN', commentId: null }),
        notif({ id: 5, type: 'STATUS_CHANGED', actorName: '김리드', actorKind: 'HUMAN', commentId: null, statusName: '검토 중' }),
        notif({ id: 6, type: 'STATUS_CHANGED', actorName: '박개발', actorKind: 'HUMAN', commentId: null, statusName: null }),
      ],
      3,
    )
    const items = await screen.findAllByTestId('inbox-item')
    expect(items[0]).toHaveTextContent('양동희님이 우선순위를 변경했습니다')
    expect(items[1]).toHaveTextContent("김리드님이 상태를 '검토 중'으로 변경했습니다")
    expect(items[2]).toHaveTextContent('박개발님이 상태를 변경했습니다')
    await user.click(items[0])
    await waitFor(() => expect(location()).toBe('/projects/WP/issues/3'))
  })

  // #659·#585 — 일정 알림(리마인더·초대)은 일정 제목을 보이고 eventId 딥링크로 간다. WP-712 — 변경·취소는 라벨, 취소는 eventId 가 없어 캘린더로.
  test('일정 알림 — 리마인더·초대는 일정 제목과 eventId 딥링크, 변경·취소는 라벨, 취소는 캘린더로 간다', async () => {
    const calendarNotif = (over: Partial<NotificationResponse>) =>
      notif({ actorId: 2, actorName: '양동희', actorKind: 'HUMAN', commentId: null, ...over })
    const { user, location } = await openInbox(
      [
        calendarNotif({ id: 2, type: 'REMINDER', actorId: null, actorName: null, actorKind: null, eventId: 5, eventTitle: '팀 회의', eventStartsAt: '2026-06-10T01:00:00Z' }),
        calendarNotif({ id: 3, type: 'CALENDAR_INVITED', eventId: 6, eventTitle: '분기 킥오프', eventStartsAt: '2026-07-10T01:00:00Z' }),
        calendarNotif({ id: 21, type: 'CALENDAR_EVENT_UPDATED', eventId: 8, eventTitle: '주간 회의', eventStartsAt: '2026-07-10T03:00:00Z' }),
        calendarNotif({ id: 22, type: 'CALENDAR_EVENT_CANCELED', eventId: null, eventTitle: '분기 리뷰', eventStartsAt: '2026-07-11T01:00:00Z' }),
      ],
      4,
    )
    const items = await screen.findAllByTestId('inbox-item')
    expect(items[0]).toHaveTextContent('일정 알림')
    expect(items[0]).toHaveTextContent('팀 회의')
    expect(items[1]).toHaveTextContent('양동희')
    expect(items[1]).toHaveTextContent('일정에 초대했습니다')
    expect(items[1]).toHaveTextContent('분기 킥오프')
    expect(items[2]).toHaveTextContent('일정을 변경했습니다')
    expect(items[2]).toHaveTextContent('주간 회의')
    expect(items[3]).toHaveTextContent('일정을 취소했습니다')
    expect(items[3]).toHaveTextContent('분기 리뷰')

    await user.click(items[1])
    await waitFor(() => expect(location()).toBe('/calendar?eventId=6'))
    await user.click(screen.getByTestId('inbox-trigger'))
    await user.click((await screen.findAllByTestId('inbox-item'))[3])
    await waitFor(() => expect(location()).toBe('/calendar'))
  })

  // WP-452 — 이슈 챗 AI 질문·멘션은 챗 드로워가 열린 이슈 상세(?chat=1)로. WP-650 — 코멘트 멘션은 드로워 없이.
  // WP-913 — AI 검토 요청·막힘은 서버 푸시와 같은 문구, 검토 요청은 드로워 없이 상세로.
  test('이슈 챗·코멘트 멘션·AI 작업 알림 문구와 이동 주소', async () => {
    const { user, reads, location } = await openInbox(
      [
        notif({ id: 21, type: 'AI_QUESTION', actorName: '개발 에이전트', commentId: null, issueNumber: 12, issueTitle: '알림 연결' }),
        notif({ id: 22, type: 'ISSUE_CHAT_MENTION', actorName: '박민수', actorKind: 'HUMAN', commentId: null, issueNumber: 12, issueTitle: '알림 연결' }),
        notif({ id: 31, type: 'ISSUE_COMMENT_MENTION', actorName: '박민수', actorKind: 'HUMAN', commentId: 501, issueNumber: 12, issueTitle: '알림 연결' }),
        notif({ id: 41, type: 'AI_REVIEW_REQUESTED', actorName: '개발 에이전트', agentWorkState: 'REVIEW', commentId: null, issueNumber: 12, issueTitle: '알림 연결' }),
        notif({ id: 42, type: 'AI_QUESTION', actorName: '개발 에이전트', agentWorkState: 'BLOCKED', commentId: null, issueNumber: 13 }),
      ],
      5,
    )
    const items = await screen.findAllByTestId('inbox-item')
    expect(items[0]).toHaveTextContent('개발 에이전트')
    expect(items[0]).toHaveTextContent('님이 이슈 챗에서 질문했습니다')
    expect(items[0]).toHaveTextContent('WP-12 알림 연결')
    expect(items[1]).toHaveTextContent('박민수님이 이슈 챗에서 회원님을 멘션했습니다')
    expect(items[2]).toHaveTextContent('박민수님이 코멘트에서 회원님을 멘션했습니다')
    expect(items[3]).toHaveTextContent('님이 검토를 요청했습니다')
    expect(items[4]).toHaveTextContent('님이 작업이 막혔다고 알렸습니다')

    await user.click(items[0])
    await waitFor(() => expect(location()).toBe('/projects/WP/issues/12?chat=1'))
    for (const [index, id] of [
      [2, 31],
      [3, 41],
    ] as const) {
      await user.click(screen.getByTestId('inbox-trigger'))
      await user.click((await screen.findAllByTestId('inbox-item'))[index])
      await waitFor(() => expect(reads).toContain(id))
      expect(location()).toBe('/projects/WP/issues/12')
    }
    expect(reads).toEqual([21, 31, 41])
  })

  // #610 — 20건 상한 해소: 바닥 근처까지 스크롤하면 offset=20 다음 페이지를 요청해 이어 붙인다.
  // jsdom 은 레이아웃이 없어 스크롤 크기를 직접 정해 「바닥에 닿음」을 만든다(닿기 전엔 요청이 없어야 한다).
  test('바닥까지 스크롤하면 offset 다음 페이지를 요청해 이어 붙인다', async () => {
    const page1 = Array.from({ length: 20 }, (_, i) => notif({ id: 20 - i, issueNumber: 20 - i }))
    const page2 = Array.from({ length: 5 }, (_, i) => notif({ id: 100 - i, issueNumber: 100 - i }))
    const offsets: (string | null)[] = []
    await openInbox((offset) => {
      offsets.push(offset)
      return offset === '20' ? page2 : page1
    }, 25)
    expect(await screen.findAllByTestId('inbox-item')).toHaveLength(20)
    const area = screen.getByTestId('inbox-scroll-area')
    Object.defineProperty(area, 'scrollHeight', { configurable: true, value: 2000 })
    Object.defineProperty(area, 'clientHeight', { configurable: true, value: 384 })
    area.scrollTop = 0
    fireEvent.scroll(area)
    expect(offsets).not.toContain('20')

    area.scrollTop = 2000 - 384
    fireEvent.scroll(area)
    await waitFor(() => expect(screen.getAllByTestId('inbox-item')).toHaveLength(25))
    expect(offsets).toContain('20')
    const items = screen.getAllByTestId('inbox-item')
    expect(items[20]).toHaveTextContent('WP-100')
    expect(items[24]).toHaveTextContent('WP-96')
  })
})
