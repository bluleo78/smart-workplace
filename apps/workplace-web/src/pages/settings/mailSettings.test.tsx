// 설정 › 메일 계정(MailSettingsPage + MailAccountsSection + MailAccountDialog) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 연결 테스트 → 저장 → 목록, 테스트 실패·저장 막힘 이유(WP-928), 포트·표시 이름 검증(WP-907·WP-929), 전역 개인 비서 토글 payload·토스트,
// 수정 다이얼로그(계정별 AI 토글 없음·id 기반 연결 테스트 #448), 연결 테스트 연타·실패 안내·다시 연 다이얼로그 잠금(WP-1770), 연결 칸을 고치면 통과 결과 무효·실패 결과는 남김(WP-1790), 삭제 확인, 공급자 기본값(WP-879)과 늦게 온 기본값,
// Outlook(M365) 팝업 흐름(성공·실패 메시지·팝업 차단·/start 실패)은 브라우저 없이 판정되므로 e2e/pages/profile/mail-accounts.spec.ts·
// settings-layout.spec.ts 에서 옮겼다. 메일 계정 화면 배선(@wiring)은 mail-accounts.spec.ts, 긴 주소의 가로 넘침(@layout)은 settings-layout.spec.ts 에 남는다.
// 팝업은 window.open 을 가짜 창으로 바꾸고, 팝업이 보내는 결과는 같은 출처의 message 이벤트로 흉내 낸다(E2E 도 같은 방식이었다).
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { MailAccountResponse } from '@/types/mailAccount'

import { createMailSettings } from '../../../e2e/factories/mailSettings.factory'
import { createMailSignature } from '../../../e2e/factories/mailSignature.factory'
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
    notifyMode: 'WORK',
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
  /** 연결 테스트 응답 상태 — 부를 때마다 앞에서 하나씩 꺼낸다(비면 200). 200 이 아니면 오류 본문을 준다(WP-1770). */
  testStatus?: number[]
  /** 기본 공급자 판단 — 프라미스를 주면 그 값이 풀릴 때까지 응답을 붙든다. */
  preferred?: boolean | Promise<boolean>
  /** /mail/oauth/m365/start 응답 상태(기본 200). */
  startStatus?: number
  /** 연결 테스트 응답을 붙들 프라미스 — 부를 때마다 앞에서 하나씩 꺼내 그 값이 풀릴 때까지 응답을 미룬다(WP-1770). */
  testGates?: Array<Promise<void>>
  /** 임시보관 개수 응답의 보내기 대기 수(WP-1786, 계정 삭제 확인창 안내). */
  queued?: number
}

/** 메일 계정 화면을 띄운다 — 서버 목록은 상태로 들고 생성·삭제·AI 토글을 반영한다. 쓰기 요청은 calls 에 쌓인다. */
async function openMail({ accounts = [], tests = [ok], testStatus = [], testGates = [], preferred = false, startStatus = 200, queued = 0 }: Opts = {}) {
  let list = [...accounts]
  const calls: Call[] = []
  const record = async (request: Request) => {
    const text = await request.text()
    const call = { method: request.method, path: new URL(request.url).pathname, body: text ? JSON.parse(text) : null }
    calls.push(call)
    return call
  }
  const nextTest = () => (tests.length > 1 ? tests.shift() : tests[0])
  // 연결 테스트 응답 — testStatus 가 200 이 아니면 서버 오류를 낸다(WP-1770)
  const testResponse = async () => {
    await testGates.shift()
    const status = testStatus.shift() ?? 200
    // 5xx 본문은 서버 내부 영문 문구 — 화면엔 호출 측 한국어 안내가 보여야 한다(WP-1879)
    return status === 200 ? HttpResponse.json(nextTest()) : HttpResponse.json({ message: 'An unexpected error occurred' }, { status })
  }
  const view = renderScreen(<MailSettingsPage />, {
    path: '/settings/mail',
    handlers: [
      http.get('/api/v1/mail/oauth/m365/status', async () => HttpResponse.json({ preferred: await preferred })),
      // 계정 목록 아래 「서명」 카드(WP-1517)가 부른다 — 이 파일은 계정만 보므로 빈 서명. 서명 카드 판정은 mailSignature.test.tsx.
      http.get('/api/v1/mail/signature', () => HttpResponse.json(createMailSignature())),
      // 「작성 방식」 카드(WP-1744)가 부른다 — 기본(우측 하단). 카드 판정은 mailComposeMode.test.tsx.
      http.get('/api/v1/mail/settings', () => HttpResponse.json(createMailSettings())),
      http.get('/api/v1/mail/accounts', () => HttpResponse.json(list)),
      // 계정 삭제 확인창이 보내기 대기 수를 읽는다(WP-1786) — 읽기라 calls 에 쌓지 않는다.
      http.get('/api/v1/mail/drafts/count', () => HttpResponse.json({ count: 0, queued })),
      http.post('/api/v1/mail/accounts/test', async ({ request }) => {
        await record(request)
        return testResponse()
      }),
      http.post('/api/v1/mail/accounts/:id/test', async ({ request }) => {
        await record(request)
        return testResponse()
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
  // WP-1770 — 연결 테스트를 연타해도 요청은 한 번만 나간다(유효성 검사 동안에도 잠김).
  test('연결 테스트를 더블클릭해도 요청은 한 번만 나간다 (WP-1770)', async () => {
    const { user, calls } = await openMail()
    await openAdd(user)
    await fillImap(user)
    // user-event 의 dblClick 은 클릭 사이에 비동기 틈이 있어 수정 전에도 통과했다 — 같은 틱에 두 번 눌러 유효성 검사 대기 구간을 재현한다.
    // 단 act() 안에서는 state(testing)만으로도 버튼이 꺼져 이 테스트는 ref 없이도 통과할 수 있다 — 관찰 가능한 동작(요청 1회)을 고정하는 용도이고,
    // ref 는 같은 틱 두 번째 클릭을 막는 안전장치다(EventDialog submittingRef #584 와 같은 패턴).
    const button = screen.getByTestId('mail-test-button')
    fireEvent.click(button)
    fireEvent.click(button)
    expect(await screen.findByTestId('mail-test-imap')).toHaveTextContent('IMAP 연결됨')
    expect(testCalls(calls)).toHaveLength(1)
  })

  test('연결 테스트가 서버 오류로 끝나도 다시 누를 수 있다 (WP-1770)', async () => {
    const { user, calls } = await openMail({ testStatus: [500, 200] })
    await openAdd(user)
    await fillImap(user)
    const button = screen.getByTestId('mail-test-button')
    await user.click(button)
    await waitFor(() => expect(testCalls(calls)).toHaveLength(1))
    // 5xx 영문 내부 문구는 호출 측 안내로 바꿔 보인다 — 실패가 조용히 묻히지 않고 영문도 새지 않는다(WP-1879)
    expect(await screen.findByText('연결 테스트에 실패했습니다')).toBeInTheDocument()
    expect(screen.queryByText('An unexpected error occurred')).not.toBeInTheDocument()
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    expect(await screen.findByTestId('mail-test-imap')).toHaveTextContent('IMAP 연결됨')
    expect(testCalls(calls)).toHaveLength(2)
  })

  test('유효성 검사에서 막힌 뒤 칸을 고치면 다시 보낸다 (WP-1770)', async () => {
    const { user, calls } = await openMail()
    await openAdd(user)
    await fillImap(user)
    await fill(user, 'mail-imap-host', '')
    await user.click(screen.getByTestId('mail-test-button'))
    // 검사가 끝나 칸 오류가 보인 뒤에 요청이 0건인지 본다 — 검사 도중이라 0건인 것과 구분
    await within(screen.getByTestId('mail-account-dialog')).findByText('IMAP 호스트를 입력하세요')
    expect(testCalls(calls)).toHaveLength(0)
    await fill(user, 'mail-imap-host', 'imap.x.com')
    await user.click(screen.getByTestId('mail-test-button'))
    expect(await screen.findByTestId('mail-test-imap')).toHaveTextContent('IMAP 연결됨')
    expect(testCalls(calls)).toHaveLength(1)
  })

  // WP-1770 — 닫았다 다시 연 뒤 늦게 온 옛 응답이 새 화면의 결과·잠금을 건드리지 않는다.
  test('다이얼로그를 닫았다 다시 열면 옛 연결 테스트 응답이 결과·저장 가능 여부에 쓰이지 않는다 (WP-1770)', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { user, calls } = await openMail({ testGates: [gate] })
    await openAdd(user)
    await fillImap(user)
    await user.click(screen.getByTestId('mail-test-button'))
    await waitFor(() => expect(testCalls(calls)).toHaveLength(1))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('mail-account-dialog')).not.toBeInTheDocument())
    await openAdd(user)
    await fillImap(user)
    // 옛 응답이 이제 도착한다
    await act(async () => {
      release()
      await delay(50)
    })
    expect(screen.queryByTestId('mail-test-imap')).not.toBeInTheDocument()
    expect(screen.getByTestId('mail-save-button')).toBeDisabled()
    const button = screen.getByTestId('mail-test-button')
    expect(button).toBeEnabled()
    await user.click(button)
    expect(await screen.findByTestId('mail-test-imap')).toHaveTextContent('IMAP 연결됨')
    expect(testCalls(calls)).toHaveLength(2)
  })

  // WP-1790 — 테스트한 값과 지금 값(연결 칸)이 같을 때만 결과를 쓴다. 표시 이름은 연결과 무관.
  test('연결 테스트 통과 뒤 연결 칸을 고치면 결과를 지우고 저장을 막는다, 표시 이름은 그대로, 되돌리면 다시 열린다 (WP-1790)', async () => {
    const { user, calls } = await openMail()
    await openAdd(user)
    await fillImap(user)
    await user.click(screen.getByTestId('mail-test-button'))
    expect(await screen.findByTestId('mail-test-imap')).toHaveTextContent('IMAP 연결됨')
    expect(screen.getByTestId('mail-save-button')).toBeEnabled()
    await fill(user, 'mail-display', '내 메일')
    expect(screen.getByTestId('mail-save-button')).toBeEnabled()
    expect(screen.getByTestId('mail-test-imap')).toBeInTheDocument()
    await fill(user, 'mail-imap-host', 'imap.other.com')
    expect(screen.queryByTestId('mail-test-imap')).not.toBeInTheDocument()
    expect(screen.getByTestId('mail-save-button')).toBeDisabled()
    expect(screen.getByTestId('mail-save-blocked-reason')).toHaveTextContent(
      '저장하려면 먼저 「연결 테스트」로 IMAP·SMTP 연결을 확인하세요.',
    )
    await fill(user, 'mail-imap-host', 'imap.x.com')
    expect(screen.getByTestId('mail-test-imap')).toBeInTheDocument()
    expect(screen.getByTestId('mail-save-button')).toBeEnabled()
    await fill(user, 'mail-pw', 'other')
    expect(screen.getByTestId('mail-save-button')).toBeDisabled()
    expect(testCalls(calls)).toHaveLength(1)
  })

  test('테스트가 도는 중에 연결 칸을 고치면 늦게 온 통과 결과로 저장이 열리지 않는다 (WP-1790)', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { user, calls } = await openMail({ testGates: [gate] })
    await openAdd(user)
    await fillImap(user)
    await user.click(screen.getByTestId('mail-test-button'))
    await waitFor(() => expect(testCalls(calls)).toHaveLength(1))
    await fill(user, 'mail-smtp-host', 'smtp.other.com')
    await act(async () => {
      release()
    })
    // 응답이 실제로 도착해 테스트가 끝났다(버튼이 다시 눌린다) — 그 뒤에도 결과는 보이지 않고 저장은 막혀 있다
    await waitFor(() => expect(screen.getByTestId('mail-test-button')).toBeEnabled())
    expect(screen.queryByTestId('mail-test-imap')).not.toBeInTheDocument()
    expect(screen.getByTestId('mail-save-button')).toBeDisabled()
    // 테스트한 값으로 되돌리면 늦게 온 통과 결과가 그 값의 결과로 보인다 — 결과가 버려진 게 아니라 지문으로 가려졌던 것
    await fill(user, 'mail-smtp-host', 'smtp.x.com')
    expect(await screen.findByTestId('mail-test-imap')).toHaveTextContent('IMAP 연결됨')
    expect(screen.getByTestId('mail-save-button')).toBeEnabled()
  })

  // WP-1790 — 통과 뒤 다른 빠른 설정을 고르면 호스트·포트가 바뀌어 결과가 무효가 된다(프리셋은 결과를 직접 지우지 않고 지문 비교에 맡긴다).
  test('연결 테스트 통과 뒤 다른 빠른 설정을 고르면 결과가 사라지고 저장이 막힌다 (WP-1790)', async () => {
    const { user } = await openMail()
    await openAdd(user)
    await choose(user, '빠른 설정(provider)', 'Gmail')
    await fill(user, 'mail-email', 'me@example.com')
    await fill(user, 'mail-imap-user', 'me@example.com')
    await fill(user, 'mail-smtp-user', 'me@example.com')
    await fill(user, 'mail-pw', 'app-password')
    await user.click(screen.getByTestId('mail-test-button'))
    expect(await screen.findByTestId('mail-test-imap')).toHaveTextContent('IMAP 연결됨')
    expect(screen.getByTestId('mail-save-button')).toBeEnabled()
    await choose(user, '빠른 설정(provider)', 'Naver')
    await waitFor(() => expect(screen.queryByTestId('mail-test-imap')).not.toBeInTheDocument())
    expect(screen.getByTestId('mail-save-button')).toBeDisabled()
  })

  // WP-1790 리뷰 후속 — 실패 결과는 연결 칸을 고쳐도 남긴다(고치는 동안 오류를 봐야 한다). 지금 값이 아니라는 보조 문구만 붙고 저장은 그대로 막힌다.
  test('연결 테스트 실패 뒤 연결 칸을 고쳐도 오류 줄이 남고, 성공했던 쪽은 통과로 보이지 않으며 「값을 바꿨어요」 안내가 붙는다 (WP-1790)', async () => {
    const { user } = await openMail({ tests: [{ imapOk: true, imapError: null, smtpOk: false, smtpError: 'SMTP 인증 실패' }] })
    await openAdd(user)
    await fillImap(user, 'bad')
    await user.click(screen.getByTestId('mail-test-button'))
    expect(await screen.findByTestId('mail-test-smtp')).toHaveTextContent('SMTP 인증 실패')
    expect(screen.queryByTestId('mail-test-stale')).not.toBeInTheDocument()
    await fill(user, 'mail-pw', 'bad2')
    expect(screen.getByTestId('mail-test-smtp')).toHaveTextContent('SMTP 인증 실패')
    // 성공했던 쪽은 테스트 안 한 값이라 「연결됨」(통과)으로 보이지 않는다
    expect(screen.getByTestId('mail-test-imap')).toHaveTextContent('IMAP 바꾸기 전 값으로 연결됨')
    expect(screen.getByTestId('mail-test-stale')).toHaveTextContent('값을 바꿨어요 — 다시 테스트하세요.')
    expect(screen.getByTestId('mail-save-button')).toBeDisabled()
    expect(screen.getByTestId('mail-save-blocked-reason')).toHaveTextContent(
      '값을 바꿨어요 — 바꾼 값으로 다시 연결 테스트를 해야 저장할 수 있어요.',
    )
    // 테스트한 값으로 되돌리면 지금 값의 결과라 보조 문구가 사라지고 원래 안내로 돌아간다
    await fill(user, 'mail-pw', 'bad')
    expect(screen.queryByTestId('mail-test-stale')).not.toBeInTheDocument()
    expect(screen.getByTestId('mail-test-imap')).toHaveTextContent('IMAP 연결됨')
    expect(screen.getByTestId('mail-save-blocked-reason')).toHaveTextContent(
      '연결 테스트를 통과해야 저장할 수 있어요. 위 오류를 고친 뒤 다시 테스트하세요.',
    )
  })

  test('메일 계정 페이지 제목은 사이드바 메뉴 라벨과 같다 (#651)', async () => {
    await openMail()
    expect(screen.getByRole('heading', { name: '메일 계정' })).toBeInTheDocument()
  })

  // WP-1772 — 선택칸 4개의 접근 이름은 보이는 라벨과 같다(WCAG 2.5.3 — Radix 의 숨은 native select 는 접근성 트리 밖).
  test('추가 대화상자의 선택칸 4개는 보이는 라벨을 이름으로 갖는다 (WP-1772)', async () => {
    const { user } = await openMail()
    await openAdd(user)
    for (const name of ['공급자', '빠른 설정(provider)', 'IMAP 보안', 'SMTP 보안']) {
      expect(screen.getByRole('combobox', { name })).toBeInTheDocument()
    }
    // 프리셋을 고른 뒤에도 이름은 라벨 그대로(값 글자로 바뀌지 않는다)
    await choose(user, '빠른 설정(provider)', 'Gmail')
    expect(screen.getByRole('combobox', { name: '빠른 설정(provider)' })).toHaveTextContent('Gmail')
  })

  test('Gmail 프리셋으로 연결 테스트 성공 → 저장 → 목록에 보인다', async () => {
    const { user, calls } = await openMail()
    await openAdd(user)
    await choose(user, '빠른 설정(provider)', 'Gmail')
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

  // WP-1770 — 수정 모드(id 기반 엔드포인트)도 연타해도 요청은 한 번이다.
  test('수정 다이얼로그에서 연결 테스트를 연타해도 요청은 한 번만 나간다 (WP-1770)', async () => {
    const { user, calls } = await openMail({ accounts: [account()] })
    await user.click(within(await screen.findByTestId('mail-account-row-1')).getByRole('button', { name: '수정' }))
    await screen.findByTestId('mail-account-dialog')
    const button = screen.getByTestId('mail-test-button')
    fireEvent.click(button)
    fireEvent.click(button)
    expect(await screen.findByTestId('mail-test-imap')).toHaveTextContent('IMAP 연결됨')
    expect(testCalls(calls).map((c) => c.path)).toEqual(['/api/v1/mail/accounts/1/test'])
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

  test('보내기 대기가 있으면 계정 삭제 확인창이 대기 건수도 함께 지워진다고 알린다, 없으면 알리지 않는다 (WP-1786)', async () => {
    const { user } = await openMail({ accounts: [account()], queued: 2 })
    await user.click(await screen.findByTestId('mail-delete-1'))
    const dialog = await screen.findByRole('alertdialog')
    expect(await within(dialog).findByText('보내기 대기 2건도 함께 삭제됩니다')).toBeInTheDocument()
  })

  test('보내기 대기가 0건이면 대기 안내가 없다 (WP-1786)', async () => {
    const { user } = await openMail({ accounts: [account()], queued: 0 })
    await user.click(await screen.findByTestId('mail-delete-1'))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('이 계정과 동기화된 메일·일정이 모두 영구 삭제됩니다.')
    // 개수 응답을 받은 뒤에도 안내가 없다
    await new Promise((r) => setTimeout(r, 50))
    expect(within(dialog).queryByTestId('delete-impact')).not.toBeInTheDocument()
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

  // WP-1901 리뷰 반려 — 진행 안내 리전은 공급자 분기 밖에 두어, IMAP→Outlook 을 바꿔도 리전이 다시 태어나지 않아야 한다.
  // 리전과 내용이 같은 렌더에 생기면 스크린리더가 안내를 건너뛴다.
  test('IMAP 에서 Outlook 으로 바꿔도 진행 안내 리전이 같은 노드로 남는다', async () => {
    const view = await openMail()
    await openAdd(view.user)
    const dialog = await screen.findByTestId('mail-account-dialog')
    const region = () => within(dialog).getByRole('status')
    const before = region()
    await choose(view.user, '공급자', 'Outlook (Microsoft 365)')
    expect(region()).toBe(before)
    expect(within(dialog).getByRole('button', { name: 'Outlook 계정 연결' })).toBeInTheDocument()
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

  // WP-1901: 팝업 차단·연결 실패 안내는 나타나는 순간 스크린리더가 읽도록 role=alert 여야 한다.
  test('팝업 차단 안내는 alert 로 읽힌다', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const { user } = await openOutlook()
    await user.click(screen.getByRole('button', { name: 'Outlook 계정 연결' }))
    const alert = await within(screen.getByTestId('mail-account-dialog')).findByRole('alert')
    expect(alert).toHaveTextContent('팝업이 차단되었습니다')
  })

  test('연결 실패 안내는 alert 로 읽힌다', async () => {
    vi.spyOn(window, 'open').mockReturnValue(fakePopup() as unknown as Window)
    const { user } = await openOutlook({ startStatus: 500 })
    await user.click(screen.getByRole('button', { name: 'Outlook 계정 연결' }))
    const alert = await within(screen.getByTestId('mail-account-dialog')).findByRole('alert')
    expect(alert).toHaveTextContent('Outlook 계정 연결에 실패했습니다')
  })

  // WP-1901: 진행 안내만 polite status 리전이고, 오류 alert 는 그 밖에 있어야 같은 안내가 두 번 읽히지 않는다.
  test('연결 실패 alert 는 status 리전 바깥에 있다', async () => {
    vi.spyOn(window, 'open').mockReturnValue(fakePopup() as unknown as Window)
    const { user } = await openOutlook({ startStatus: 500 })
    await user.click(screen.getByRole('button', { name: 'Outlook 계정 연결' }))
    const alert = await within(screen.getByTestId('mail-account-dialog')).findByRole('alert')
    expect(alert.closest('[role="status"]')).toBeNull()
  })

  test('진행 안내는 status 리전으로 읽힌다', async () => {
    vi.spyOn(window, 'open').mockReturnValue(fakePopup() as unknown as Window)
    const { user } = await openOutlook()
    await user.click(screen.getByRole('button', { name: 'Outlook 계정 연결' }))
    const progress = await within(screen.getByTestId('mail-account-dialog')).findByRole('status')
    expect(progress).toHaveTextContent(/Microsoft 창에서 인증을 진행하세요/)
  })

  test('/start 조회가 실패하면 팝업 차단이 아니라 일반 연결 실패 오류를 보인다', async () => {
    vi.spyOn(window, 'open').mockReturnValue(fakePopup() as unknown as Window)
    const { user } = await openOutlook({ startStatus: 500 })
    await user.click(screen.getByRole('button', { name: 'Outlook 계정 연결' }))
    expect(await screen.findByText(/Outlook 계정 연결에 실패했습니다/)).toBeInTheDocument()
    expect(screen.queryByText(/팝업이 차단되었습니다/)).not.toBeInTheDocument()
  })
})
