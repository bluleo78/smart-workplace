// 설정 › SSO(SsoSettingsPage, WP-48) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 운영자 미설정 비활성·켜져 있으면 끌 수 있음·SSO 전용 구성원 확인·Clipboard API 없을 때 대체 복사(WP-836)·칸·확인창의 도움말 절 연결(WP-1508)은
// 브라우저 없이 판정되므로 e2e/pages/settings/sso.spec.ts 에서 옮겼다. 사이드바 → SSO 이동 배선(@wiring)과 실제 클립보드 복사(@platform)는 sso.spec.ts 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { currentScreenContext, withScreenContextProbe } from '@/test/kits/ai/ScreenContextProbe'
import { expectHelpTarget } from '@/test/kits/help/expectHelpTarget'
import { helpBundleHandlers } from '@/test/kits/help/helpBundleKit'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'
import { testAuthValue } from '@/test/renderWithProviders'

import { withAssistant, withoutClipboardApi } from '../settings/testkit-b7'
import SsoSettingsPage from './SsoSettingsPage'

const CONSENT = 'https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=abc'
const settings = (over: Record<string, unknown> = {}) => ({
  available: true,
  enabled: false,
  adminConsentUrl: CONSENT,
  passwordlessMemberCount: 0,
  ...over,
})

/** SSO 화면을 띄운다 — PUT /admin/sso/enabled 본문은 puts 에 쌓인다. */
async function openSso(over: Record<string, unknown> = {}, aiAvailable = true) {
  const puts: unknown[] = []
  const view = renderScreen(withAssistant(<SsoSettingsPage />), {
    path: '/settings/sso',
    auth: { user: { ...testAuthValue.user!, aiAvailable } },
    handlers: [
      http.get('/api/v1/admin/sso', () => HttpResponse.json(settings(over))),
      http.put('/api/v1/admin/sso/enabled', async ({ request }) => {
        puts.push(await request.json())
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  })
  const toggle = await screen.findByRole('switch', { name: 'SSO 로그인 사용' })
  // 응답이 와 스위치가 서버 값을 반영할 때까지 기다린다.
  await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', String(Boolean(settings(over).enabled))))
  return { ...view, puts, toggle }
}

test('운영자 미설정이면 토글이 비활성이고 안내가 보인다', async () => {
  const { toggle } = await openSso({ available: false, adminConsentUrl: null })
  await waitFor(() => expect(toggle).toBeDisabled())
  expect(screen.getByText('SSO 를 사용하려면 운영자 설정이 필요합니다.')).toBeInTheDocument()
})

// 운영자 env 가 사라져도 이미 켜져 있으면 끌 수 있어야 한다.
test('운영자 설정이 사라져도 켜져 있으면 끌 수 있다', async () => {
  const { user, toggle, puts } = await openSso({ available: false, enabled: true, adminConsentUrl: null })
  expect(toggle).toBeEnabled()
  await user.click(toggle)
  await waitFor(() => expect(puts).toEqual([{ enabled: false }]))
})

test('끌 때 SSO 전용 구성원이 있으면 확인한 뒤에만 끈다', async () => {
  const { user, toggle, puts } = await openSso({ enabled: true, passwordlessMemberCount: 3 })
  await user.click(toggle)
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('비밀번호가 없는 SSO 전용 구성원 3명이 로그인할 수 없게 됩니다. 계속하시겠습니까?')
  expect(puts).toHaveLength(0)
  await user.click(within(dialog).getByRole('button', { name: '끄기' }))
  await waitFor(() => expect(puts).toEqual([{ enabled: false }]))
})

test('SSO 전용 구성원이 없으면 확인 없이 끈다', async () => {
  const { user, toggle, puts } = await openSso({ enabled: true })
  await user.click(toggle)
  await waitFor(() => expect(puts).toEqual([{ enabled: false }]))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

// WP-836 — Clipboard API 가 없는 http 배포에서도 execCommand 대체 경로로 복사하고, 둘 다 안 되면 직접 복사하라고 안내한다.
test('Clipboard API 가 없으면 대체 경로로 동의 링크를 복사한다 (WP-836)', async () => {
  // userEvent.setup()(renderScreen 안)이 자기 클립보드 대역을 심으므로, 화면을 띄운 뒤에 Clipboard API 를 없앤다.
  const { user } = await openSso()
  const clip = withoutClipboardApi(true)
  try {
    await user.click(screen.getByRole('button', { name: '복사' }))
    expect(await screen.findByText('링크를 복사했습니다.')).toBeInTheDocument()
    expect(clip.copied).toEqual([CONSENT])
  } finally {
    clip.restore()
  }
})

test('복사할 수 없으면 직접 선택해 복사하라고 안내한다 (WP-836)', async () => {
  // userEvent.setup()(renderScreen 안)이 자기 클립보드 대역을 심으므로, 화면을 띄운 뒤에 Clipboard API 를 없앤다.
  const { user } = await openSso()
  const clip = withoutClipboardApi(false)
  try {
    await user.click(screen.getByRole('button', { name: '복사' }))
    expect(await screen.findByText('복사에 실패했습니다. 링크를 직접 선택해 복사하세요.')).toBeInTheDocument()
  } finally {
    clip.restore()
  }
})

// WP-1508 — 칸을 만지면 도움말 패널이 여는 절은 가장 가까운 [data-help] 조상의 값이다.
test('칸과 끄기 확인창이 맞는 도움말 절로 이어진다 (WP-1508)', async () => {
  const { user, toggle } = await openSso({ enabled: true, passwordlessMemberCount: 3 })
  expectHelpTarget(screen.getByRole('heading', { level: 2, name: 'SSO 로그인' }), 'sso.login')
  expectHelpTarget(toggle, 'sso.login')
  expectHelpTarget(screen.getByRole('heading', { level: 2, name: '관리자 동의 링크' }), 'sso.consent')
  await user.click(toggle)
  expectHelpTarget(await screen.findByRole('alertdialog'), 'sso.login.off')
})

// 설정 가이드 대신 매뉴얼 대표 절 요약이 AI 화면 참고에 실린다.
test('가이드 없이 화면 참고에 「설정 · SSO」와 매뉴얼 설명이 실린다 (WP-1508)', async () => {
  renderScreen(withScreenContextProbe(<SsoSettingsPage />), {
    path: '/settings/sso',
    auth: { isAdmin: true },
    handlers: [
      ...helpBundleHandlers(),
      http.get('/api/v1/admin/sso', () => HttpResponse.json(settings({ enabled: true }))),
      ...shellHandlers,
    ],
  })
  await screen.findByRole('switch', { name: 'SSO 로그인 사용' })
  await waitFor(() => expect(currentScreenContext()?.scope?.facts).toContainEqual({ label: '소개', value: '로그인 본문.' }))
  expect(currentScreenContext()!.view).toBe('설정 · SSO')
  const facts = currentScreenContext()!.scope!.facts!
  expect(facts).toContainEqual({ label: 'SSO 로그인', value: 'SSO 로그인 본문.' })
  expect(facts).toContainEqual({ label: 'SSO 로그인', value: '켜짐' })
})
