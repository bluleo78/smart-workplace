// 설정 앱 내비게이션 — 페이지 테스트(WP-971).
// 구 경로 리다이렉트(/profile·/admin/*·/settings/wiki-sharing), 관리 그룹·앱 설정 그룹의 역할별 노출, AdminRoute 직접 주소 차단,
// 사이드바 링크로 화면 이동·선택 표시는 브라우저 없이 판정되므로 e2e/pages/settings/settings-nav.spec.ts·settings-layout.spec.ts·notification-settings.spec.ts·
// work-app-settings.spec.ts·wiki-sharing.spec.ts 에서 옮겼다. 선택 항목의 계산된 배경색(@layout)은 settings-nav.spec.ts 에 남는다.
// renderPage 를 쓰는 이유: 라우트 매칭(Navigate·AdminRoute 가드)과 설정 모듈 레이아웃(사이드바)·이동한 화면 내용을 함께 본다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { MOCK_ADMIN_ROLE, MOCK_USER_ROLE } from '@/test/msw/baseHandlers'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { createUser } from '../../../e2e/factories/auth.factory'

const ADMIN = { user: createUser({ aiAvailable: false }), roles: [MOCK_ADMIN_ROLE, MOCK_USER_ROLE] }

/** 설정 화면들이 부르는 조회 — 이동한 화면이 그려질 만큼만 빈 응답으로 준다. */
const settingsHandlers = [
  http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: false, vapidPublicKey: null })),
  http.get('/api/v1/admin/issue-relation-types', () => HttpResponse.json([])),
  http.get('/api/v1/admin/wiki/shares', () => HttpResponse.json([])),
  http.get('/api/v1/admin/wiki/share-policy', () => HttpResponse.json({ externalShareEnabled: true })),
]

const sidebar = () => screen.findByTestId('settings-sidebar', {}, { timeout: PAGE_LOAD_TIMEOUT })

describe('구 경로 리다이렉트', () => {
  test('구 /profile 은 /settings/profile 로 간다', async () => {
    const { location } = renderPage('/profile', { handlers: settingsHandlers })
    expect(await screen.findByRole('heading', { name: '비밀번호 변경' }, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(location()).toBe('/settings/profile')
  })

  // 착지한 구성원 화면은 공용 PageHeader(제목 「구성원」)에 추가 버튼을 둔다(e2e settings-layout.spec 에서 옮김).
  test('구 /admin/users 는 /settings/users 로 가고 구성원 헤더·추가 버튼이 보인다(관리자)', async () => {
    const { location } = renderPage('/admin/users', { ...ADMIN, handlers: settingsHandlers })
    expect(await screen.findByTestId('add-member-button', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(screen.getByTestId('page-header')).toHaveTextContent('구성원')
    expect(location()).toBe('/settings/users')
  })

  // WP-887 — 「워크스페이스 관리 › 노트 공유」를 「앱 설정 › 노트」로 옮겼다. 옛 주소는 새 주소로 보내고 사이드바는 「노트」를 고른다.
  test('옛 /settings/wiki-sharing 은 /settings/apps/wiki 로 가고 사이드바 「앱 설정 › 노트」가 선택된다 (WP-887)', async () => {
    const { location } = renderPage('/settings/wiki-sharing', { ...ADMIN, handlers: settingsHandlers })
    expect(await screen.findByTestId('wiki-sharing-admin-page', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(location()).toBe('/settings/apps/wiki')
    expect(within(screen.getByTestId('settings-apps-group')).getByRole('link', { name: '노트' })).toHaveAttribute('aria-current', 'page')
  })
})

describe('일반 사용자', () => {
  test('관리 그룹·앱 설정 그룹이 없고 「내 공유」는 보인다', async () => {
    renderPage('/settings/profile', { handlers: settingsHandlers })
    const nav = await sidebar()
    expect(within(nav).getByRole('link', { name: '내 공유' })).toBeInTheDocument()
    expect(screen.queryByTestId('settings-admin-group')).not.toBeInTheDocument()
    expect(screen.queryByTestId('settings-apps-group')).not.toBeInTheDocument()
  })

  // AdminRoute 가 홈으로 돌려보내고 관리자 화면은 그려지지 않는다(옛 노트 공유 주소도 같다).
  test.each(['/settings/users', '/settings/apps/work', '/settings/apps/wiki', '/settings/wiki-sharing'])(
    '%s 직접 접근은 홈으로 돌려보낸다',
    async (path) => {
      const { location } = renderPage(path, { handlers: settingsHandlers })
      await waitFor(() => expect(location()).toBe('/'), { timeout: PAGE_LOAD_TIMEOUT })
      expect(screen.queryByTestId('work-app-settings-page')).not.toBeInTheDocument()
      expect(screen.queryByTestId('wiki-sharing-admin-page')).not.toBeInTheDocument()
      expect(screen.queryByTestId('add-member-button')).not.toBeInTheDocument()
    },
  )

  test('사이드바 「알림」으로 알림 설정 화면에 간다', async () => {
    const { user, location } = renderPage('/settings/profile', { handlers: settingsHandlers })
    await user.click(within(await sidebar()).getByRole('link', { name: '알림' }))
    expect(await screen.findByTestId('notification-settings-page')).toBeInTheDocument()
    expect(location()).toBe('/settings/notifications')
  })
})

describe('관리자', () => {
  // WP-887 — 앱 설정 그룹에 「작업 관리·노트」가 있고, 작업 관리로 가면 그 링크가 선택된다.
  test('사이드바 「앱 설정 › 작업 관리」로 이동하고 선택 표시가 붙는다 (WP-887)', async () => {
    const { user, location } = renderPage('/settings/profile', { ...ADMIN, handlers: settingsHandlers })
    await sidebar()
    const group = screen.getByTestId('settings-apps-group')
    expect(within(group).getByRole('link', { name: '노트' })).toBeInTheDocument()
    await user.click(within(group).getByRole('link', { name: '작업 관리' }))
    expect(await screen.findByTestId('work-app-settings-page')).toBeInTheDocument()
    expect(location()).toBe('/settings/apps/work')
    expect(within(group).getByRole('link', { name: '작업 관리' })).toHaveAttribute('aria-current', 'page')
  })
})
