// 설정 › 프로필(ProfileSettingsPage) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 이메일 검증 안내(WP-912)·새 비밀번호 복잡도(#794)·비밀번호 보기 토글과 autocomplete(#263·#365)·SSO 전용 계정의 비밀번호 설정(WP-48)은
// 브라우저 없이 판정되므로 e2e/pages/settings/profile-email-validation·profile-password-complexity·profile-password-toggle·
// profile-set-password.spec.ts 에서 옮겼다. 프로필 화면 배선(@wiring)은 settings-layout.spec.ts 가 지킨다.
// 아바타 섹션(WP-1222) — 파일 검사·자르기 창·업로드 payload(자른 영역)·되돌리기·갱신도 여기서 본다.
// 화면 컴포넌트만 renderScreen 으로 띄운다 — 프로필 화면은 사용자 정보를 AuthContext 에서 읽고 저장만 API 로 보낸다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test, vi } from 'vitest'

import { renderScreen, type ScreenUser } from '@/test/renderScreen'
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

// ── 아바타(WP-1222) ────────────────────────────────────────────────────────────────
// 파일 고르기 → 형식·크기 검사 → 자르기 창(이미지 읽은 뒤 가로·세로 검사) → 저장 = 원본 파일 + 원본 픽셀 자른 영역 PUT →
// 아바타 표·내 정보 갱신. 끌기·휠의 실제 브라우저 입력은 기하 순수 함수(lib/avatarCrop.test)가 지키고, 여기서는 슬라이더(키보드 가능)로 본다.

type AvatarCall = { method: string; fields: Record<string, string> }

/** 아바타 API — 받은 요청과 multipart 의 글자 필드(cropX 등)를 모은다. putStatus 를 주면 PUT 이 그 상태로 실패한다. */
function avatarHandlers(putStatus?: number) {
  const calls: AvatarCall[] = []
  return {
    calls,
    handlers: [
      http.put('/api/v1/users/me/avatar', async ({ request }) => {
        const fd = await request.formData()
        const fields: Record<string, string> = {}
        fd.forEach((v, k) => {
          fields[k] = typeof v === 'string' ? v : 'FILE'
        })
        calls.push({ method: 'PUT', fields })
        if (putStatus) return HttpResponse.json({ message: '이미지를 읽을 수 없습니다' }, { status: putStatus })
        return HttpResponse.json({ avatarUrl: '/api/v1/avatars/1/newhash' })
      }),
      http.delete('/api/v1/users/me/avatar', () => {
        calls.push({ method: 'DELETE', fields: {} })
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  }
}

/** 아바타 섹션을 가진 프로필 화면 — avatarUrl 이 있으면 그 사용자로 그린다. refreshUser 는 부른 횟수를 센다. */
async function openAvatar(
  opts: { avatarUrl?: string | null; putStatus?: number; path?: string; refreshFails?: boolean } = {},
) {
  const api = avatarHandlers(opts.putStatus)
  // refreshFails — 저장 뒤 내 정보 갱신(GET /users/me)이 실패하는 경우를 흉내 낸다.
  const refreshUser = vi.fn(async () => {
    if (opts.refreshFails) throw new Error('refresh failed')
  })
  const view = renderScreen(<ProfileSettingsPage />, {
    path: opts.path ?? '/settings/profile',
    handlers: api.handlers,
    auth: { user: { ...testAuthValue.user!, avatarUrl: opts.avatarUrl ?? null }, refreshUser },
  })
  const section = await screen.findByTestId('profile-avatar-section')
  const invalidate = vi.spyOn(view.queryClient, 'invalidateQueries')
  return { ...view, calls: api.calls, refreshUser, invalidate, section }
}

const png = (size = 1000) => {
  const file = new File(['png'], 'me.png', { type: 'image/png' })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

/** 파일을 고르고 자르기 창의 이미지가 width×height 로 읽힌 것처럼 load 를 보낸다(jsdom 은 이미지를 디코딩하지 않는다). */
async function chooseAndLoad(user: ScreenUser, width: number, height: number, file = png()) {
  await user.upload(screen.getByLabelText('아바타 이미지 파일'), file)
  const img = await screen.findByTestId('avatar-crop-image')
  Object.defineProperty(img, 'naturalWidth', { value: width })
  Object.defineProperty(img, 'naturalHeight', { value: height })
  fireEvent.load(img)
}

test('아바타 섹션 — 이니셜 미리보기·바꾸기·안내, 아바타가 없으면 되돌리기는 없다 (WP-1222)', async () => {
  const { section } = await openAvatar()
  expect(within(section).getByRole('heading', { name: '아바타' })).toBeInTheDocument()
  expect(section).toHaveAttribute('id', 'avatar')
  expect(within(section).getByTestId('profile-avatar-preview')).toHaveTextContent('T')
  expect(within(section).getByTestId('profile-avatar-preview').querySelector('img')).toBeNull()
  expect(within(section).getByRole('button', { name: '이미지 바꾸기' })).toBeInTheDocument()
  expect(within(section).queryByRole('button', { name: '기본으로 되돌리기' })).not.toBeInTheDocument()
  expect(section).toHaveTextContent('PNG·JPEG·GIF·WebP, 5MB 이하 — 정사각으로 잘라 저장합니다')
  expect(within(section).getByLabelText('아바타 이미지 파일')).toHaveAttribute('accept', 'image/png,image/jpeg,image/gif,image/webp')
})

test('파일을 고르면 자르기 창 → 저장은 원본 파일과 가운데 정사각 영역을 보내고 아바타 표·내 정보를 갱신한다 (WP-1222)', async () => {
  const { user, calls, refreshUser, invalidate } = await openAvatar()
  await chooseAndLoad(user, 800, 600)
  const dialog = screen.getByTestId('avatar-crop-dialog')
  expect(within(dialog).getByRole('heading', { name: '아바타 자르기' })).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: '저장' }))

  await waitFor(() => expect(calls).toHaveLength(1))
  // 800×600 의 가운데 정사각 = (100, 0) 에서 600.
  expect(calls[0]).toEqual({ method: 'PUT', fields: { file: 'FILE', cropX: '100', cropY: '0', cropSize: '600' } })
  expect(await screen.findByText('아바타를 바꿨습니다.')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('avatar-crop-dialog')).not.toBeInTheDocument())
  expect(refreshUser).toHaveBeenCalledTimes(1)
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['avatars'] })
})

test('확대 슬라이더를 2배로 올리면 가운데를 유지한 채 변이 절반인 영역을 보낸다 (WP-1222)', async () => {
  const { user, calls } = await openAvatar()
  await chooseAndLoad(user, 800, 600)
  const zoom = screen.getByRole('slider', { name: '확대' })
  // 짧은 변 600 → 확대 상한 600/128 ≈ 4.69 이지만 4배로 묶인다.
  expect(zoom).toHaveAttribute('max', '4')
  fireEvent.change(zoom, { target: { value: '2' } })
  await user.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(calls).toHaveLength(1))
  expect(calls[0].fields).toMatchObject({ cropX: '250', cropY: '150', cropSize: '300' })
})

test('자르기 창의 화살표 키는 보는 곳을 옮긴다 — 왼쪽 끝을 넘지 않는다 (WP-1222)', async () => {
  const { user, calls } = await openAvatar()
  await chooseAndLoad(user, 800, 600)
  const frame = screen.getByTestId('avatar-crop-frame')
  frame.focus()
  // 원 지름 208px 에 600px 이 맞으니 화면 10px = 원본 약 28.8px. 왼쪽으로 크게 옮기면 cropX 0 에서 멈춘다.
  for (let i = 0; i < 10; i++) await user.keyboard('{ArrowLeft}')
  await user.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(calls).toHaveLength(1))
  expect(calls[0].fields).toMatchObject({ cropX: '0', cropY: '0', cropSize: '600' })
})

test('취소하면 아무 요청 없이 창이 닫힌다 (WP-1222)', async () => {
  const { user, calls } = await openAvatar()
  await chooseAndLoad(user, 400, 400)
  await user.click(screen.getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByTestId('avatar-crop-dialog')).not.toBeInTheDocument())
  expect(calls).toHaveLength(0)
})

test('형식·크기·가로세로가 맞지 않으면 한국어 안내를 보이고 올리지 않는다 (WP-1222)', async () => {
  const { user, calls, section } = await openAvatar()
  const input = within(section).getByLabelText('아바타 이미지 파일')

  // 크기 5MB 초과.
  await user.upload(input, png(5 * 1024 * 1024 + 1))
  expect(await within(section).findByRole('alert')).toHaveTextContent('5MB 이하의 이미지만 올릴 수 있습니다.')
  expect(screen.queryByTestId('avatar-crop-dialog')).not.toBeInTheDocument()

  // 짧은 변 128px 미만 — 창이 이미지를 읽은 뒤 닫고 안내.
  await chooseAndLoad(user, 300, 100)
  await waitFor(() => expect(screen.queryByTestId('avatar-crop-dialog')).not.toBeInTheDocument())
  expect(within(section).getByRole('alert')).toHaveTextContent('가로·세로 128px 이상인 이미지를 골라 주세요.')

  // 형식 — accept 를 우회해 고른 경우(드래그·모든 파일 보기)도 막는다. user.upload 는 accept 로 걸러 버려 change 를 직접 보낸다(마지막에:
  // files 를 배열로 덮어 그 뒤의 user.upload 가 깨진다).
  fireEvent.change(input, { target: { files: [new File(['x'], 'a.svg', { type: 'image/svg+xml' })] } })
  expect(within(section).getByRole('alert')).toHaveTextContent('PNG·JPEG·GIF·WebP 이미지만 올릴 수 있습니다.')
  expect(screen.queryByTestId('avatar-crop-dialog')).not.toBeInTheDocument()
  expect(calls).toHaveLength(0)
})

test('서버가 거절하면 오류를 알리고 자르기 창은 남아 다시 저장할 수 있다 (WP-1222)', async () => {
  const { user, calls, refreshUser } = await openAvatar({ putStatus: 400 })
  await chooseAndLoad(user, 400, 400)
  await user.click(screen.getByRole('button', { name: '저장' }))
  expect(await screen.findByText('이미지를 읽을 수 없습니다')).toBeInTheDocument()
  expect(calls).toHaveLength(1)
  expect(screen.getByTestId('avatar-crop-dialog')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '저장' })).toBeEnabled()
  expect(refreshUser).not.toHaveBeenCalled()
})

test('저장은 성공했는데 뒤이은 갱신이 실패해도 저장된 것으로 본다 — 실패 안내 없이 창을 닫는다 (WP-1222)', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { user, calls, refreshUser } = await openAvatar({ refreshFails: true })
  await chooseAndLoad(user, 400, 400)
  await user.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(calls).toHaveLength(1))
  expect(await screen.findByText('아바타를 바꿨습니다.')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('avatar-crop-dialog')).not.toBeInTheDocument())
  expect(refreshUser).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('아바타를 바꾸지 못했습니다.')).not.toBeInTheDocument()
  expect(warn).toHaveBeenCalled()
  warn.mockRestore()
})

test('아바타가 있으면 이미지(256px 벌)와 되돌리기 — 되돌리면 DELETE 후 갱신한다 (WP-1222)', async () => {
  const { user, calls, refreshUser, invalidate, section } = await openAvatar({ avatarUrl: '/api/v1/avatars/1/oldhash' })
  const img = within(within(section).getByTestId('profile-avatar-preview')).getByRole('img', { name: 'Tester' })
  expect(img).toHaveAttribute('src', '/api/v1/avatars/1/oldhash/256')
  await user.click(within(section).getByRole('button', { name: '기본으로 되돌리기' }))
  await waitFor(() => expect(calls).toEqual([{ method: 'DELETE', fields: {} }]))
  expect(await screen.findByText('기본 아바타로 되돌렸습니다.')).toBeInTheDocument()
  expect(refreshUser).toHaveBeenCalledTimes(1)
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['avatars'] })
})

test('#avatar 로 들어오면 아바타 섹션으로 스크롤한다 (WP-1222)', async () => {
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
  const { section } = await openAvatar({ path: '/settings/profile#avatar' })
  await waitFor(() => expect(scroll).toHaveBeenCalled())
  expect(scroll.mock.contexts[0]).toBe(section)
})
