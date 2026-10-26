// 모바일 앱 목록·탭 편집·알림 화면(WP-121/WP-126) — 페이지 테스트(WP-981).
// 고정 앱 교체(우클릭 메뉴)·계정 시트 내용·테마 전환·로그아웃·탭 편집 저장 비활성·홈 멘션 셀 이동·알림 빈 상태는
// 브라우저 없이 판정되므로 e2e/pages/mobile/apps.spec.ts 에서 옮겼다. 길게 누르기(@input)·새로고침 뒤 유지(@platform)·
// 앱 목록과 알림 화면 배선(@wiring)은 E2E 에 남는다. 데스크톱 폭 /apps → 홈은 mobileAppsDesktop.test.tsx.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { ThemeProvider } from 'next-themes'
import { describe, expect, test } from 'vitest'

import { AccountSheet } from '@/components/mobile/AccountSheet'
import { server } from '@/test/msw/server'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { renderWithProviders } from '@/test/renderWithProviders'
import { mockViewport } from '@/test/viewport'

import { createMembership } from '../../../e2e/factories/auth.factory'

mockViewport()

/** 탭바 버튼 testid 를 화면(DOM) 순서대로 — 배지·AI 캡슐 같은 접두 testid 는 뺀다. */
function tabIds() {
  return [...screen.getByTestId('mobile-tabbar').querySelectorAll('[data-testid^="mobile-tab-"]')]
    .map((e) => e.getAttribute('data-testid'))
    .filter((id) => id && !id.startsWith('mobile-tab-badge') && id !== 'mobile-tab-ai-capsule')
}

/** /apps 를 열고 그리드가 뜰 때까지 기다린다. */
async function openApps(handlers: Parameters<typeof renderPage>[1] = {}) {
  const view = renderPage('/apps', handlers)
  await screen.findByTestId('apps-app-settings', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return view
}

describe('앱 목록', () => {
  // 고정된 앱의 메뉴는 「교체」만 — 후보는 탭바에 없는 앱(설정 제외)이고, 고른 앱은 같은 칸에 들어간다.
  test('고정된 앱 우클릭 → 다른 앱으로 교체하면 같은 자리에 들어가고 이동하지 않는다', async () => {
    const { user, location } = await openApps()
    fireEvent.contextMenu(screen.getByTestId('apps-app-chat'))
    expect(await screen.findByTestId('apps-menu')).toBeInTheDocument()
    expect(screen.queryByTestId('apps-pin')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('apps-swap'))
    expect(screen.queryByTestId('apps-swap-to-home')).not.toBeInTheDocument()
    expect(screen.queryByTestId('apps-swap-to-settings')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('apps-swap-to-wiki'))
    expect(await screen.findByText('노트를 탭바에 고정했어요')).toBeInTheDocument()
    expect(tabIds()).toEqual([
      'mobile-tab-home', 'mobile-tab-wiki', 'mobile-tab-mail', 'mobile-tab-ai', 'mobile-tab-calendar', 'mobile-tab-drive', 'mobile-tab-apps',
    ])
    expect(location()).toBe('/apps')
  })

  // 설정은 탭바에 고정할 수 없다 — 우클릭해도 메뉴가 없다.
  test('설정은 우클릭해도 메뉴가 뜨지 않는다', async () => {
    const { location } = await openApps()
    fireEvent.contextMenu(screen.getByTestId('apps-app-settings'))
    expect(screen.queryByTestId('apps-menu')).not.toBeInTheDocument()
    expect(location()).toBe('/apps')
  })

  // 계정 시트 — 레일용 스위처·유저 메뉴 대신 아바타 → 시트에 이름·이메일·워크스페이스(✓ 현재)·프로필·로그아웃.
  test('아바타 → 계정 시트: 이름·이메일, 워크스페이스(현재 표시), 프로필로 이동', async () => {
    const acorn = createMembership()
    const globex = createMembership({ tenantId: 20, tenantName: 'Globex', tenantSlug: 'globex' })
    // AuthContext 는 활성 테넌트를 localStorage 에서 복원한다(E2E 의 addInitScript 와 같음).
    window.localStorage.setItem('activeTenant', JSON.stringify(acorn))
    const { user, location } = await openApps({
      handlers: [http.get('/api/v1/auth/memberships', () => HttpResponse.json([acorn, globex]))],
    })
    expect(screen.queryByTestId('workspace-switcher')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rail-user-menu')).not.toBeInTheDocument()
    const avatar = screen.getByTestId('apps-account')
    expect(avatar).toHaveAccessibleName('내 계정')
    expect(avatar).toHaveTextContent('테')
    await user.click(avatar)
    const sheet = await screen.findByTestId('apps-account-sheet')
    expect(within(sheet).getByText('테스트 사용자')).toBeInTheDocument()
    expect(within(sheet).getByText('test@example.com')).toBeInTheDocument()
    expect(within(sheet).getByText('워크스페이스', { exact: true })).toBeInTheDocument()
    expect(await within(sheet).findByTestId('apps-workspace-20')).toHaveTextContent('Globex')
    expect(within(sheet).getByTestId('apps-workspace-1')).toHaveTextContent('에이콘 워크스페이스')
    expect(within(sheet).getByTestId('apps-workspace-1')).toHaveAttribute('aria-current', 'true')
    expect(within(sheet).getByTestId('apps-logout')).toHaveTextContent(/로그아웃/)
    await user.click(within(sheet).getByTestId('apps-profile'))
    await waitFor(() => expect(location()).toBe('/settings/profile'))
  })

  test('계정 시트의 로그아웃은 로그인 화면으로', async () => {
    const { user, location } = await openApps({
      handlers: [
        http.post('/api/v1/auth/logout', () => HttpResponse.json({})),
        // 로그인 화면이 띄울 때 부르는 가입·SSO 가능 여부.
        http.get('/api/v1/auth/signup-available', () => HttpResponse.json({ available: false })),
        http.get('/api/v1/auth/sso/status', () => HttpResponse.json({ m365: false })),
      ],
    })
    await user.click(screen.getByTestId('apps-account'))
    await user.click(await screen.findByTestId('apps-logout'))
    await waitFor(() => expect(location()).toMatch(/^\/login/))
  })

  test('「탭바 순서 편집」 링크 → /apps/tabs', async () => {
    const { user, location } = await openApps()
    await user.click(screen.getByTestId('apps-edit-tabs'))
    await waitFor(() => expect(location()).toBe('/apps/tabs'))
  })
})

describe('탭 편집', () => {
  // 넓은 폰은 5칸 — 하나라도 비우면 저장할 수 없다.
  test('칸을 다 채우지 않으면 저장 불가', async () => {
    const { user } = renderPage('/apps/tabs')
    expect(await screen.findByText(/나머지 5칸을 고르세요/, {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    await user.click(screen.getByTestId('tab-edit-remove-0'))
    expect(screen.getByTestId('tab-edit-save')).toBeDisabled()
  })
})

describe('알림', () => {
  // 홈 합성 위젯의 멘션 셀은 openInbox() — 모바일에선 팝오버 대신 /notifications 화면으로 간다.
  test('홈 멘션 셀(openInbox)은 모바일에서 /notifications 로 이동', async () => {
    const { user, location } = renderPage('/', {
      handlers: [
        // 홈 셸이 푸시 알림 설정을 확인한다 — 꺼진 서버로 둔다.
        http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: false, vapidPublicKey: null })),
        http.get('/api/v1/me/dashboard', () => HttpResponse.json({ widgets: [{ id: 'synthesis', type: 'synthesis', count: 5, hidden: false }] })),
      ],
    })
    const counts = await screen.findByTestId('dashboard-counts', {}, { timeout: PAGE_LOAD_TIMEOUT })
    await user.click(within(counts).getByRole('button', { name: /^멘션/ }))
    await waitFor(() => expect(location()).toBe('/notifications'))
  })

  // 탭바에 고정하지 않은 알림은 🔔 로 여는 푸시 화면 — 탭바 없이 뒤로가기 헤더(U1-5).
  test('알림 화면: 빈 상태, 탭바 없이 뒤로가기 헤더', async () => {
    renderPage('/notifications', {
      handlers: [http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: false, vapidPublicKey: null }))],
    })
    expect(await screen.findByTestId('inbox-empty', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(screen.queryByTestId('mobile-tabbar')).not.toBeInTheDocument()
    expect(screen.getByTestId('mobile-back')).toBeInTheDocument()
  })
})

describe('계정 시트 — 테마', () => {
  // 테마 전환 줄은 next-themes 로 html 의 dark 클래스를 켜고 끈다. ThemeProvider 는 main.tsx 에 있어 renderPage(App) 밖이라
  // 시트를 ThemeProvider 로 감싼 컴포넌트 테스트로 본다(main.tsx 와 같은 attribute="class").
  test('계정 시트의 테마 전환은 html 의 dark 클래스를 토글한다', async () => {
    document.documentElement.classList.remove('dark')
    const whatsNew = { unread: false, open: false, setOpen: () => {} }
    // 시트가 열리면 워크스페이스 목록을 부른다(고정 AuthContext 에 활성 테넌트가 있다).
    server.use(http.get('/api/v1/auth/memberships', () => HttpResponse.json([createMembership()])))
    renderWithProviders(
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
        <AccountSheet open onOpenChange={() => {}} whatsNew={whatsNew} />
      </ThemeProvider>,
    )
    const user = userEvent.setup()
    const theme = await screen.findByTestId('apps-account-theme')
    expect(theme).toHaveTextContent(/테마 전환/)
    expect(document.documentElement).not.toHaveClass('dark')
    await user.click(theme)
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'))
    await user.click(screen.getByTestId('apps-account-theme'))
    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'))
  })
})
