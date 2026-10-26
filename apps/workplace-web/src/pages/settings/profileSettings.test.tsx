// 설정 › 프로필(ProfileSettingsPage) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 이메일 검증 안내(WP-912)·새 비밀번호 복잡도(#794)·비밀번호 보기 토글과 autocomplete(#263·#365)·SSO 전용 계정의 비밀번호 설정(WP-48)은
// 브라우저 없이 판정되므로 e2e/pages/settings/profile-email-validation·profile-password-complexity·profile-password-toggle·
// profile-set-password.spec.ts 에서 옮겼다. 프로필 화면 배선(@wiring)은 settings-layout.spec.ts 가 지킨다.
// 화면 컴포넌트만 renderScreen 으로 띄운다 — 프로필 화면은 사용자 정보를 AuthContext 에서 읽고 저장만 API 로 보낸다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import { testAuthValue } from '@/test/renderWithProviders'

import ProfileSettingsPage from './ProfileSettingsPage'

/** 프로필 화면이 부르는 쓰기 API — 받은 요청을 calls 에 모은다(나가면 안 되는 요청도 이것으로 센다). */
function writeHandlers() {
  const calls: { method: string; path: string; body: unknown }[] = []
  const record = async (request: Request) => {
    const text = await request.text()
    calls.push({ method: request.method, path: new URL(request.url).pathname, body: text ? JSON.parse(text) : null })
  }
  return {
    calls,
    handlers: [
      http.put('/api/v1/users/me', async ({ request }) => {
        await record(request)
        return HttpResponse.json({})
      }),
      http.put('/api/v1/users/me/password', async ({ request }) => {
        await record(request)
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  }
}

/** 프로필 화면을 띄운다 — hasPassword 를 주면 그 계정으로 그린다. */
async function openProfile(hasPassword = true) {
  const api = writeHandlers()
  const view = renderScreen(<ProfileSettingsPage />, {
    path: '/settings/profile',
    handlers: api.handlers,
    auth: { user: { ...testAuthValue.user!, hasPassword } },
  })
  await screen.findByRole('heading', { level: 2, name: hasPassword ? '비밀번호 변경' : '비밀번호 설정' })
  return { ...view, calls: api.calls }
}

// WP-912 — 이메일 칸(type=email)의 브라우저 기본 검증이 제출을 가로채 zod 의 한국어 안내가 남지 않았다. 폼 noValidate 로 안내가 칸 아래에 보인다.
test('프로필 이메일이 잘못되면 칸 아래에 한국어 안내를 보이고 저장하지 않는다 (WP-912)', async () => {
  const { user, calls } = await openProfile()
  const email = screen.getByLabelText('이메일') as HTMLInputElement
  await user.clear(email)
  await user.paste('not-an-email')
  await user.click(screen.getAllByRole('button', { name: '저장' })[0])

  expect(await screen.findByText('유효한 이메일을 입력하세요')).toBeInTheDocument()
  // 브라우저 기본 검증이 제출을 가로채지 않게 폼에 noValidate 가 있다(jsdom 은 기본 말풍선이 없어 이 속성으로 지킨다).
  expect(email.form?.noValidate).toBe(true)
  expect(calls).toHaveLength(0)
})

// #794 — 새 비밀번호 복잡도는 서버 왕복 없이 클라이언트(zod)가 막고, 영문 서버 문구가 아니라 한국어 안내를 보인다.
// 숫자·소문자 누락 문구와 규칙 충족 시 에러 없음은 validations/user.test(passwordRule)가 지킨다.
test('대문자 없이 소문자+숫자만 입력하면 서버 요청 없이 한국어 에러가 즉시 표시된다 (#794)', async () => {
  const { user, calls } = await openProfile()
  await user.click(screen.getByLabelText('현재 비밀번호'))
  await user.paste('wrongpass')
  await user.click(screen.getByLabelText('새 비밀번호'))
  await user.paste('newpass123')
  await user.click(screen.getByLabelText('비밀번호 확인'))
  await user.paste('newpass123')
  await user.click(screen.getByRole('button', { name: '비밀번호 변경' }))

  expect(await screen.findByText('대문자를 1자 이상 포함해야 합니다')).toBeInTheDocument()
  expect(screen.queryByText(/Password must contain/)).not.toBeInTheDocument()
  expect(calls).toHaveLength(0)
})

// #263·WP-923 — 비밀번호 칸 셋이 각자 보기/숨기기 버튼을 갖고(이름에 칸 이름), 누를 때마다 type 이 password↔text 로 바뀐다.
// #365 — 브라우저 비밀번호 매니저 호환을 위한 autocomplete(현재 = current-password, 새·확인 = new-password).
test('비밀번호 칸 셋은 각자 보기/숨기기 토글로 type 이 바뀌고 autocomplete 가 맞다 (#263·#365)', async () => {
  const { user } = await openProfile()
  for (const [label, id, autocomplete] of [
    ['현재 비밀번호', 'current-password', 'current-password'],
    ['새 비밀번호', 'new-password', 'new-password'],
    ['비밀번호 확인', 'confirm-password', 'new-password'],
  ] as const) {
    const input = document.getElementById(id) as HTMLInputElement
    expect(input).toHaveAttribute('autocomplete', autocomplete)
    expect(input).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: `${label} 보기` }))
    expect(input).toHaveAttribute('type', 'text')
    // 숨기기로 이름이 바뀐 같은 버튼을 다시 누르면 password 로 돌아온다.
    await user.click(screen.getByRole('button', { name: `${label} 숨기기` }))
    expect(input).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: `${label} 보기` })).toBeInTheDocument()
  }
})

// WP-48 — 비밀번호 없는(SSO 전용) 계정은 현재 비밀번호 칸 없이 「비밀번호 설정」 카드로 새 비밀번호만 보낸다.
test('비밀번호 없는 계정은 새 비밀번호만으로 설정한다 (WP-48)', async () => {
  const { user, calls } = await openProfile(false)
  expect(document.getElementById('current-password')).toBeNull()
  await user.click(document.getElementById('set-new-password')!)
  await user.paste('Password123')
  await user.click(document.getElementById('set-confirm-password')!)
  await user.paste('Password123')
  await user.click(screen.getByRole('button', { name: '비밀번호 설정' }))
  await waitFor(() => expect(calls).toEqual([{ method: 'PUT', path: '/api/v1/users/me/password', body: { newPassword: 'Password123' } }]))
})

test('비밀번호가 있는 계정은 기존 변경 카드를 보인다 (WP-48)', async () => {
  await openProfile(true)
  expect(document.getElementById('current-password')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '비밀번호 설정' })).not.toBeInTheDocument()
})
