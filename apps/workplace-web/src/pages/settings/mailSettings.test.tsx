// 설정 › 메일 계정(MailSettingsPage + MailAccountsSection + MailAccountDialog) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 연결 테스트 → 저장 → 목록, 테스트 실패·저장 막힘 이유(WP-928), 포트·표시 이름 검증(WP-907·WP-929), 전역 개인 비서 토글 payload·토스트,
// 수정 다이얼로그(계정별 AI 토글 없음·id 기반 연결 테스트 #448), 삭제 확인, 공급자 기본값(WP-879)과 늦게 온 기본값,
// Outlook(M365) 팝업 흐름(성공·실패 메시지·팝업 차단·/start 실패)은 브라우저 없이 판정되므로 e2e/pages/profile/mail-accounts.spec.ts·
// settings-layout.spec.ts 에서 옮겼다. 메일 계정 화면 배선(@wiring)은 mail-accounts.spec.ts, 긴 주소의 가로 넘침(@layout)은 settings-layout.spec.ts 에 남는다.
// 팝업은 window.open 을 가짜 창으로 바꾸고, 팝업이 보내는 결과는 같은 출처의 message 이벤트로 흉내 낸다(E2E 도 같은 방식이었다).
import { act, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { MailAccountResponse } from '@/types/mailAccount'

import MailSettingsPage from './MailSettingsPage'

/** 기본 메일 계정 픽스처(e2e mail-accounts.spec 과 같은 값). */
function account(overrides?: Partial<MailAccountResponse>): MailAccountResponse {
  return {
    id: 1,
    provider: 'IMAP',
    emailAddress: 'me@example.com',
    displayName: '내 계정',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecurity: 'SSL_TLS',
    imapUsername: 'me@example.com',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
    smtpUsername: 'me@example.com',
    aiEnabled: false,
    lastSyncedAt: null,
    lastTestedAt: '2026-06-03T00:00:00Z',
    createdAt: '2026-06-03T00:00:00Z',
    updatedAt: '2026-06-03T00:00:00Z',
    ...overrides,
  }
}

const ok = { imapOk: true, imapError: null, smtpOk: true, smtpError: null }
type Call = { method: string; path: string; body: unknown }

type Opts = {
  accounts?: MailAccountResponse[]
  /** 연결 테스트 응답 — 부를 때마다 앞에서 하나씩 꺼낸다(마지막 값은 계속 쓴다). */
  tests?: Array<Record<string, unknown>>
  /** 기본 공급자 판단 — 프라미스를 주면 그 값이 풀릴 때까지 응답을 붙든다. */
  preferred?: boolean | Promise<boolean>
  /** /mail/oauth/m365/start 응답 상태(기본 200). */
  startStatus?: number
}

/** 메일 계정 화면을 띄운다 — 서버 목록은 상태로 들고 생성·삭제·AI 토글을 반영한다. 쓰기 요청은 calls 에 쌓인다. */
async function openMail({ accounts = [], tests = [ok], preferred = false, startStatus = 200 }: Opts = {}) {
  let list = [...accounts]
  const calls: Call[] = []
  const record = async (request: Request) => {
    const text = await request.text()
    const call = { method: request.method, path: new URL(request.url).pathname, body: text ? JSON.parse(text) : null }
    calls.push(call)
    return call
  }
  const nextTest = () => (tests.length > 1 ? tests.shift() : tests[0])
  const view = renderScreen(<MailSettingsPage />, {
    path: '/settings/mail',
    handlers: [
      http.get('/api/v1/mail/oauth/m365/status', async () => HttpResponse.json({ preferred: await preferred })),
      http.get('/api/v1/mail/accounts', () => HttpResponse.json(list)),
      http.post('/api/v1/mail/accounts/test', async ({ request }) => {
        await record(request)
        return HttpResponse.json(nextTest())
      }),
      http.post('/api/v1/mail/accounts/:id/test', async ({ request }) => {
        await record(request)
        return HttpResponse.json(nextTest())
      }),
      http.post('/api/v1/mail/accounts', async ({ request }) => {
        await record(request)
        const created = account()
        list = [created]
        return HttpResponse.json(created)
      }),
      http.patch('/api/v1/mail/accounts/ai-enabled', async ({ request }) => {
        const { body } = await record(request)
        list = list.map((a) => ({ ...a, aiEnabled: (body as { aiEnabled: boolean }).aiEnabled }))
        return new HttpResponse(null, { status: 204 })
      }),
      http.delete('/api/v1/mail/accounts/:id', async ({ request, params }) => {
        await record(request)
        list = list.filter((a) => a.id !== Number(params.id))
        return new HttpResponse(null, { status: 204 })
      }),
      http.get('/api/v1/mail/oauth/m365/start', async ({ request }) => {
        await record(request)
        return startStatus === 200
          ? HttpResponse.json({ authorizeUrl: 'https://login.microsoftonline.com/authorize?x=1' })
          : HttpResponse.json({ message: 'server error' }, { status: startStatus })
      }),
    ],
  })
  await screen.findByTestId('mail-accounts-section')
  return { ...view, calls }
}

type User = Awaited<ReturnType<typeof openMail>>['user']
const byId = (id: string) => document.getElementById(id) as HTMLInputElement

/** id 칸을 비우고 value 를 붙여 넣는다(키마다 user.type 하지 않는다). */
async function fill(user: User, id: string, value: string) {
  await user.clear(byId(id))
  if (value) await user.paste(value)
}

/** 추가 다이얼로그를 연다. */
async function openAdd(user: User) {
  await user.click(screen.getByTestId('mail-add-trigger'))
  return screen.findByTestId('mail-account-dialog')
}

/** 직접 입력 IMAP 필드를 채운다(비밀번호 포함). */
async function fillImap(user: User, password = 'pw') {
  await fill(user, 'mail-email', 'me@example.com')
  await fill(user, 'mail-imap-host', 'imap.x.com')
  await fill(user, 'mail-imap-user', 'me@example.com')
  await fill(user, 'mail-smtp-host', 'smtp.x.com')
  await fill(user, 'mail-smtp-user', 'me@example.com')
  await fill(user, 'mail-pw', password)
}

/** Radix Select(콤보박스)에서 옵션을 고른다. */
async function choose(user: User, combobox: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: combobox }))
  await user.click(await screen.findByRole('option', { name: option }))
}

const testCalls = (calls: Call[]) => calls.filter((c) => c.path.endsWith('/test'))

describe('계정 추가', () => {
  test('메일 계정 페이지 제목은 사이드바 메뉴 라벨과 같다 (#651)', async () => {
    await openMail()
    expect(screen.getByRole('heading', { name: '메일 계정' })).toBeInTheDocument()
  })

  test('Gmail 프리셋으로 연결 테스트 성공 → 저장 → 목록에 보인다', async () => {
    const { user, calls } = await openMail()
    await openAdd(user)
    await choose(user, 'provider 프리셋', 'Gmail')
    await fill(user, 'mail-email', 'me@example.com')
    await fill(user, 'mail-imap-user', 'me@example.com')
    await fill(user, 'mail-smtp-user', 'me@example.com')
    await fill(user, 'mail-pw', 'app-password')
    // 테스트 전 저장 버튼은 비활성.
    expect(screen.getByTestId('mail-save-button')).toBeDisabled()

    await user.click(screen.getByTestId('mail-test-button'))
    expect(await screen.findByTestId('mail-test-imap')).toHaveTextContent('IMAP 연결됨')
    expect(screen.getByTestId('mail-test-smtp')).toHaveTextContent('SMTP 연결됨')
    // 프리셋이 호스트를 채워 보냈다.
    expect(testCalls(calls)[0].body).toMatchObject({ imapHost: 'imap.gmail.com', smtpHost: 'smtp.gmail.com' })

    await user.click(screen.getByTestId('mail-save-button'))
    const row = await screen.findByTestId('mail-account-row-1')
    expect(row).toHaveTextContent('me@example.com')
    // 공급자 칸 — IMAP 은 호스트(M365_GRAPH 의 Outlook 라벨 규칙은 mailAccountProvider.test 가 지킨다).
    expect(row).toHaveTextContent('imap.gmail.com')
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/v1/mail/accounts')?.body).toMatchObject({ emailAddress: 'me@example.com' })
  })

  test('목록이 비면 안내를 보이고 전역 개인 비서 토글은 숨긴다', async () => {
    await openMail()
    expect(await screen.findByText(/연결된 메일 계정이 없습니다/)).toBeInTheDocument()
    expect(screen.queryByTestId('mail-ai-global-section')).not.toBeInTheDocument()
  })

  test('연결 테스트가 실패하면 오류를 보이고 저장은 막힌다', async () => {
    const { user } = await openMail({ tests: [{ imapOk: false, imapError: '인증 실패 — 사용자명 또는 비밀번호를 확인하세요', smtpOk: true, smtpError: null }] })
    await openAdd(user)
    await fillImap(user, 'bad')
    await user.click(screen.getByTestId('mail-test-button'))
    expect(await screen.findByTestId('mail-test-result')).toHaveTextContent('인증 실패')
    expect(screen.getByTestId('mail-save-button')).toBeDisabled()
  })

  // WP-907 — 포트 칸을 비우거나 소수를 넣으면 zod 영어 원문 대신 한국어 안내를 보이고 연결 테스트를 보내지 않는다.
  test('포트 칸이 비거나 소수면 한국어 안내를 보이고 연결 테스트를 보내지 않는다 (WP-907)', async () => {
    const { user, calls } = await openMail()
    const dialog = within(await openAdd(user))
    await fillImap(user)
    await fill(user, 'mail-imap-port', '')
    await fill(user, 'mail-smtp-port', '587.5')
    await user.click(screen.getByTestId('mail-test-button'))
    expect(await dialog.findByText('포트를 입력하세요')).toBeInTheDocument()
    expect(dialog.getByText('포트는 소수점 없는 정수여야 합니다')).toBeInTheDocument()
    expect(dialog.queryByText(/Invalid input|expected/)).not.toBeInTheDocument()
    expect(testCalls(calls)).toHaveLength(0)
  })

  // WP-928 — 저장 버튼이 연결 테스트 전까지 이유 없이 회색이었다. 막힌 이유와 할 일을 보이고, 통과하면 사라진다.
  test('연결 테스트 전·실패 시 저장이 막힌 이유를 보이고, 통과하면 사라진다 (WP-928)', async () => {
    const { user } = await openMail({ tests: [{ imapOk: false, imapError: '인증 실패', smtpOk: true, smtpError: null }, ok] })
    await openAdd(user)
    const save = screen.getByTestId('mail-save-button')
    expect(save).toBeDisabled()
    expect(screen.getByTestId('mail-save-blocked-reason')).toHaveTextContent('저장하려면 먼저 「연결 테스트」로 IMAP·SMTP 연결을 확인하세요.')
    expect(save).toHaveAttribute('aria-describedby', 'mail-save-blocked-reason')

    await fillImap(user)
    await user.click(screen.getByTestId('mail-test-button'))
    await waitFor(() =>
      expect(screen.getByTestId('mail-save-blocked-reason')).toHaveTextContent('연결 테스트를 통과해야 저장할 수 있어요. 위 오류를 고친 뒤 다시 테스트하세요.'),
    )

    await user.click(screen.getByTestId('mail-test-button'))
    await waitFor(() => expect(screen.queryByTestId('mail-save-blocked-reason')).not.toBeInTheDocument())
    expect(save).toBeEnabled()
    expect(save).not.toHaveAttribute('aria-describedby')
  })

  // WP-929 — 표시 이름 120자 초과는 연결 테스트를 눌러도 반응이 없었다. 칸 아래 오류를 그리고 요청은 보내지 않는다.
  test('표시 이름이 120자를 넘으면 오류 문구가 보이고 연결 테스트 요청은 나가지 않는다 (WP-929)', async () => {
    const { user, calls } = await openMail()
    await openAdd(user)
    await fillImap(user)
    await fill(user, 'mail-display', '가'.repeat(121))
    await user.click(screen.getByTestId('mail-test-button'))
    await waitFor(() => expect(byId('mail-display-error')).toHaveTextContent('표시 이름은 120자 이하여야 합니다'))
    expect(byId('mail-display')).toHaveAttribute('aria-invalid', 'true')
    expect(testCalls(calls)).toHaveLength(0)
  })
})

describe('계정 목록', () => {
  test('전역 개인 비서 토글을 켜면 PATCH /ai-enabled 를 보내고 토스트를 띄운다', async () => {
    const { user, calls } = await openMail({ accounts: [account({ aiEnabled: false })] })
    const toggle = await screen.findByTestId('mail-ai-global')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await user.click(toggle)
    await waitFor(() => expect(calls).toEqual([{ method: 'PATCH', path: '/api/v1/mail/accounts/ai-enabled', body: { aiEnabled: true } }]))
    expect(await screen.findByText('개인 비서를 켰습니다')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('mail-ai-global')).toHaveAttribute('aria-checked', 'true'))
  })

  test('aiEnabled 인 계정이 하나라도 있으면 전역 토글이 켜져 있다', async () => {
    await openMail({ accounts: [account({ aiEnabled: true })] })
    expect(await screen.findByTestId('mail-ai-global')).toHaveAttribute('aria-checked', 'true')
  })

  test('수정 다이얼로그에는 계정별 AI 토글이 없고, 비밀번호 없이 연결 테스트하면 id 기반 엔드포인트로 빈 비밀번호를 보낸다 (#448)', async () => {
    const { user, calls } = await openMail({ accounts: [account()] })
    await user.click(within(await screen.findByTestId('mail-account-row-1')).getByRole('button', { name: '수정' }))
    await screen.findByTestId('mail-account-dialog')
    expect(screen.queryByTestId('mail-ai-enabled')).not.toBeInTheDocument()
    // 비밀번호는 프리필되지 않는다 — 서버가 저장값으로 폴백한다.
    expect(byId('mail-pw')).toHaveValue('')
    await user.click(screen.getByTestId('mail-test-button'))
    expect(await screen.findByTestId('mail-test-imap')).toHaveTextContent('IMAP 연결됨')
    expect(screen.getByTestId('mail-test-smtp')).toHaveTextContent('SMTP 연결됨')
    expect(testCalls(calls).map((c) => c.path)).toEqual(['/api/v1/mail/accounts/1/test'])
    expect((testCalls(calls)[0].body as { password: string }).password).toBe('')
  })

  test('계정 삭제는 확인 대화상자 뒤에만 실행되고, 취소하면 행이 남는다 (#182)', async () => {
    const { user, calls } = await openMail({ accounts: [account()] })
    await user.click(await screen.findByTestId('mail-delete-1'))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('이 계정과 동기화된 메일·일정이 모두 영구 삭제됩니다.')
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('mail-account-row-1')).toBeInTheDocument()
    expect(calls).toHaveLength(0)

    await user.click(screen.getByTestId('mail-delete-1'))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(screen.queryByTestId('mail-account-row-1')).not.toBeInTheDocument())
    expect(calls).toEqual([{ method: 'DELETE', path: '/api/v1/mail/accounts/1', body: null }])
  })
})

// #499·WP-879 — 공급자 선택 분기와 워크스페이스 기본 공급자.
describe('공급자', () => {
  test('Outlook 공급자를 고르면 OAuth 연결 버튼이 보이고 IMAP 호스트 칸은 사라진다 (#499)', async () => {
    const { user } = await openMail()
    await openAdd(user)
    await choose(user, '공급자', 'Outlook (Microsoft 365)')
    expect(screen.getByRole('button', { name: 'Outlook 계정 연결' })).toBeInTheDocument()
    expect(byId('mail-imap-host')).toBeNull()
  })

  test('Microsoft 로그인 워크스페이스는 추가 다이얼로그가 Outlook 을 미리 골라 두고, IMAP 으로 바꿀 수 있다 (WP-879)', async () => {
    const { user } = await openMail({ preferred: true })
    await openAdd(user)
    await waitFor(() => expect(screen.getByRole('combobox', { name: '공급자' })).toHaveTextContent('Outlook (Microsoft 365)'))
    expect(screen.getByRole('button', { name: 'Outlook 계정 연결' })).toBeInTheDocument()
    expect(byId('mail-imap-host')).toBeNull()
    await choose(user, '공급자', 'IMAP (앱 비밀번호)')
    expect(byId('mail-imap-host')).toBeInTheDocument()
  })

  test('Microsoft 로그인을 쓰지 않는 워크스페이스는 추가 다이얼로그가 IMAP 기본이다 (WP-879)', async () => {
    const { user } = await openMail()
    await openAdd(user)
    expect(screen.getByRole('combobox', { name: '공급자' })).toHaveTextContent('IMAP (앱 비밀번호)')
    expect(byId('mail-imap-host')).toBeInTheDocument()
  })

  test('기본값 조회가 늦게 와도 이미 고른 공급자와 입력값은 그대로다 (WP-879)', async () => {
    let release!: (v: boolean) => void
    const held = new Promise<boolean>((r) => (release = r))
    const { user } = await openMail({ preferred: held })
    await openAdd(user)
    await choose(user, '공급자', 'IMAP (앱 비밀번호)')
    await fill(user, 'mail-imap-host', 'imap.example.com')
    release(true)
    // 응답이 반영될 틈을 준 뒤에도 사용자가 고른 IMAP 과 입력값이 남는다.
    await act(() => delay(50))
    expect(screen.getByRole('combobox', { name: '공급자' })).toHaveTextContent('IMAP (앱 비밀번호)')
    expect(byId('mail-imap-host')).toHaveValue('imap.example.com')
  })

  test('Microsoft 로그인 워크스페이스여도 기존 IMAP 계정 수정은 IMAP 그대로다 (WP-879)', async () => {
    const { user } = await openMail({ preferred: true, accounts: [account()] })
    await user.click(within(await screen.findByTestId('mail-account-row-1')).getByRole('button', { name: '수정' }))
    await screen.findByTestId('mail-account-dialog')
    await waitFor(() => expect(byId('mail-imap-host')).toHaveValue('imap.gmail.com'))
    expect(screen.queryByRole('button', { name: 'Outlook 계정 연결' })).not.toBeInTheDocument()
  })
})

// M365 Outlook 연결 — 팝업 흐름. window.open 은 동기로 연 가짜 창, 결과는 같은 출처 message 이벤트로 흉내 낸다.
describe('Outlook 연결 팝업', () => {
  afterEach(() => vi.restoreAllMocks())

  /** 가짜 팝업 창 — location.href 로 인가 주소가 실렸는지 본다. */
  const fakePopup = () => ({ location: { href: '' }, closed: false, close() {} })

  async function openOutlook(opts: Opts = {}) {
    const view = await openMail(opts)
    await openAdd(view.user)
    await choose(view.user, '공급자', 'Outlook (Microsoft 365)')
    return view
  }
  const postResult = (data: unknown) =>
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin }))
    })

  test('연결 버튼 → 팝업 open + /start 의 인가 주소로 이동 + 진행 안내, 성공 메시지면 토스트와 함께 닫힌다', async () => {
    const popup = fakePopup()
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    const { user } = await openOutlook()
    await user.click(screen.getByRole('button', { name: 'Outlook 계정 연결' }))
    expect(open).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(popup.location.href).toContain('login.microsoftonline.com'))
    expect(screen.getByText(/Microsoft 창에서 인증을 진행하세요/)).toBeInTheDocument()

    await postResult({ source: 'm365-oauth', ok: true })
    expect(await screen.findByText('Outlook 메일 계정이 연결되었습니다.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('mail-account-dialog')).not.toBeInTheDocument())
  })

  test('실패 메시지를 받으면 인라인 오류를 보인다', async () => {
    vi.spyOn(window, 'open').mockReturnValue(fakePopup() as unknown as Window)
    const { user } = await openOutlook()
    await user.click(screen.getByRole('button', { name: 'Outlook 계정 연결' }))
    await screen.findByText(/Microsoft 창에서 인증을 진행하세요/)
    await postResult({ source: 'm365-oauth', ok: false, error: 'connect_failed' })
    expect(await screen.findByText(/Outlook 계정 연결에 실패했습니다/)).toBeInTheDocument()
  })

  test('팝업이 차단되면(window.open null) /start 없이 바로 차단 안내를 보인다', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const { user, calls } = await openOutlook()
    await user.click(screen.getByRole('button', { name: 'Outlook 계정 연결' }))
    expect(await screen.findByText(/팝업이 차단되었습니다/)).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  test('/start 조회가 실패하면 팝업 차단이 아니라 일반 연결 실패 오류를 보인다', async () => {
    vi.spyOn(window, 'open').mockReturnValue(fakePopup() as unknown as Window)
    const { user } = await openOutlook({ startStatus: 500 })
    await user.click(screen.getByRole('button', { name: 'Outlook 계정 연결' }))
    expect(await screen.findByText(/Outlook 계정 연결에 실패했습니다/)).toBeInTheDocument()
    expect(screen.queryByText(/팝업이 차단되었습니다/)).not.toBeInTheDocument()
  })
})
