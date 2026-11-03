import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { server } from '../../test/msw/server'
import { renderWithProviders } from '../../test/renderWithProviders'
import type { SecurityCheckView } from '../../types/securityCheck'
import { HtmlPreview } from './HtmlPreview'
import { SecurityCheckCard } from './SecurityCheckCard'

const SCRIPT_HTML = '<html><body><script>1</script></body></html>'
const PATH = '/api/v1/drive/files/9/security-check'
const view = (p: Partial<SecurityCheckView> = {}): SecurityCheckView => ({
  status: null, risk: null, headline: null, evidence: [], checkedAt: null, reason: null, ...p,
})
const ev = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: 'OTHER', detail: `d${i}` }))

/** GET 은 get() 이 돌려주는 값을, POST 는 post() 값을 주고 요청 횟수를 센다. */
function mockApi(get: () => SecurityCheckView, post: () => SecurityCheckView = () => view({ status: 'PENDING' })) {
  const calls = { get: 0, post: 0 }
  server.use(
    http.get('*/drive/files/9/security-check', () => { calls.get++; return HttpResponse.json(get()) }),
    http.post('*/drive/files/9/security-check', () => { calls.post++; return HttpResponse.json(post()) }),
  )
  return calls
}
const sandbox = () => screen.getByTestId('html-document').getAttribute('sandbox') ?? ''
const sw = () => screen.getByRole('switch', { name: '스크립트 실행' })

afterEach(() => vi.useRealTimers())

describe('HtmlPreview 보안 점검 줄', () => {
  it('showsNoNoticeAndNoRequest_whenNoScripts', async () => {
    const calls = mockApi(() => view())
    renderWithProviders(<HtmlPreview html="<p>hi</p>" title="t" securityCheckPath={PATH} />)
    expect(screen.queryByTestId('html-script-notice')).not.toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 30))
    expect(calls).toEqual({ get: 0, post: 0 })
  })

  it('showsIdleButtonAndBlocksScripts_whenStatusNull', async () => {
    mockApi(() => view())
    renderWithProviders(<HtmlPreview html={SCRIPT_HTML} title="t" securityCheckPath={PATH} />)
    expect(screen.getByText('이 문서에는 스크립트가 있어요')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'AI 보안 점검' })).toBeInTheDocument()
    expect(sw()).toHaveAttribute('aria-checked', 'false')
    expect(sandbox()).not.toContain('allow-scripts')
  })

  it('requestsCheckAndShowsResult_whenButtonClicked', async () => {
    let state: SecurityCheckView = view()
    const calls = mockApi(() => state, () => { state = view({ status: 'CHECKING' }); return state })
    const user = userEvent.setup()
    renderWithProviders(<HtmlPreview html={SCRIPT_HTML} title="t" securityCheckPath={PATH} />)
    await user.click(await screen.findByRole('button', { name: 'AI 보안 점검' }))
    expect(await screen.findByText('AI 가 점검하는 중…')).toBeInTheDocument()
    await waitFor(() => expect(calls.post).toBe(1))
    state = view({ status: 'DONE', risk: 'CAUTION', evidence: ev(3), headline: 'h' })
    expect(await screen.findByText('주의 · 위협 3', {}, { timeout: 6000 })).toBeInTheDocument()
  })

  // WP-1283: 지난 판정 기준의 결과는 칩을 그대로 두고 「다시 점검」으로 새 기준 점검을 요청한다.
  it('offersRecheck_whenResultIsOutdated', async () => {
    let state: SecurityCheckView = view({ status: 'DONE', risk: 'CAUTION', evidence: ev(2), outdated: true })
    const calls = mockApi(() => state, () => { state = view({ status: 'PENDING' }); return state })
    const user = userEvent.setup()
    renderWithProviders(<HtmlPreview html={SCRIPT_HTML} title="t" securityCheckPath={PATH} />)
    expect(await screen.findByText('주의 · 위협 2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '다시 점검' }))
    await waitFor(() => expect(calls.post).toBe(1))
    expect(await screen.findByText('AI 가 점검하는 중…')).toBeInTheDocument()
  })

  it('hidesRecheck_whenResultIsCurrent', async () => {
    mockApi(() => view({ status: 'DONE', risk: 'LOW', evidence: ev(2), outdated: false }))
    renderWithProviders(<HtmlPreview html={SCRIPT_HTML} title="t" securityCheckPath={PATH} />)
    expect(await screen.findByText('낮음 · 위협 없음')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시 점검' })).not.toBeInTheDocument()
  })

  it('allowsWithoutConfirmAndTurnsOff_whenCaution', async () => {
    mockApi(() => view({ status: 'DONE', risk: 'CAUTION', evidence: ev(3) }))
    const user = userEvent.setup()
    renderWithProviders(<HtmlPreview html={SCRIPT_HTML} title="t" securityCheckPath={PATH} />)
    await screen.findByText('주의 · 위협 3')
    await user.click(sw())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(sandbox()).toContain('allow-scripts')
    expect(screen.getByText('스크립트 실행 중')).toBeInTheDocument()
    await user.click(sw())
    expect(sandbox()).not.toContain('allow-scripts')
  })

  it('confirmsBeforeAllowing_whenHigh', async () => {
    mockApi(() => view({ status: 'DONE', risk: 'HIGH', headline: '비밀번호를 가로채요', evidence: ev(1) }))
    const user = userEvent.setup()
    renderWithProviders(<HtmlPreview html={SCRIPT_HTML} title="t" securityCheckPath={PATH} />)
    expect(await screen.findByText('비밀번호를 가로채요', { selector: 'span' })).toBeInTheDocument()
    await user.click(sw())
    expect(await screen.findByText('위험할 수 있는 스크립트예요')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '취소' }))
    expect(sw()).toHaveAttribute('aria-checked', 'false')
    await user.click(sw())
    await user.click(await screen.findByRole('button', { name: '그래도 실행' }))
    await waitFor(() => expect(sw()).toHaveAttribute('aria-checked', 'true'))
    expect(sandbox()).toContain('allow-scripts')
  })

  it('offersRetry_whenFailed', async () => {
    const calls = mockApi(() => view({ status: 'FAILED' }))
    const user = userEvent.setup()
    renderWithProviders(<HtmlPreview html={SCRIPT_HTML} title="t" securityCheckPath={PATH} />)
    expect(await screen.findByText('보안 점검을 하지 못했어요')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '다시 점검' }))
    await waitFor(() => expect(calls.post).toBe(1))
  })

  it('showsRetry_whenGetFails', async () => {
    const calls = { post: 0 }
    server.use(
      http.get('*/drive/files/9/security-check', () => HttpResponse.json({}, { status: 500 })),
      http.post('*/drive/files/9/security-check', () => { calls.post++; return HttpResponse.json(view({ status: 'CHECKING' })) }),
    )
    const user = userEvent.setup()
    renderWithProviders(<HtmlPreview html={SCRIPT_HTML} title="t" securityCheckPath={PATH} />)
    expect(await screen.findByText('보안 점검을 하지 못했어요')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '다시 점검' }))
    await waitFor(() => expect(calls.post).toBe(1))
  })

  it('showsFailure_whenPostFails', async () => {
    server.use(
      http.get('*/drive/files/9/security-check', () => HttpResponse.json(view())),
      http.post('*/drive/files/9/security-check', () => HttpResponse.json({}, { status: 500 })),
    )
    const user = userEvent.setup()
    renderWithProviders(<HtmlPreview html={SCRIPT_HTML} title="t" securityCheckPath={PATH} />)
    await user.click(await screen.findByRole('button', { name: 'AI 보안 점검' }))
    expect(await screen.findByText('보안 점검을 하지 못했어요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 점검' })).toBeInTheDocument()
  })

  it('showsRunningText_whenHighAndAllowed', async () => {
    mockApi(() => view({ status: 'DONE', risk: 'HIGH', headline: '비밀번호를 가로채요', evidence: ev(1) }))
    const user = userEvent.setup()
    renderWithProviders(<HtmlPreview html={SCRIPT_HTML} title="t" securityCheckPath={PATH} />)
    await screen.findByText('비밀번호를 가로채요', { selector: 'span' })
    await user.click(sw())
    await user.click(await screen.findByRole('button', { name: '그래도 실행' }))
    expect(await screen.findByText('스크립트 실행 중')).toBeInTheDocument()
    expect(screen.queryByText('비밀번호를 가로채요', { selector: 'span' })).not.toBeInTheDocument()
  })

  it('showsTextOnly_whenNoAi', async () => {
    mockApi(() => view({ reason: 'NO_AI' }))
    renderWithProviders(<HtmlPreview html={SCRIPT_HTML} title="t" securityCheckPath={PATH} />)
    expect(await screen.findByText('보안 점검을 하지 못했어요')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시 점검' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AI 보안 점검' })).not.toBeInTheDocument()
  })

  it('showsSwitchOnlyAndNoRequest_whenNoPath', async () => {
    const calls = mockApi(() => view())
    renderWithProviders(<HtmlPreview html={SCRIPT_HTML} title="t" />)
    expect(sw()).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AI 보안 점검' })).not.toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 30))
    expect(calls).toEqual({ get: 0, post: 0 })
  })

  it('callsOnOpenPanel_whenResultChipClicked', async () => {
    mockApi(() => view({ status: 'DONE', risk: 'LOW' }))
    const onOpenPanel = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<HtmlPreview html={SCRIPT_HTML} title="t" securityCheckPath={PATH} onOpenPanel={onOpenPanel} />)
    await user.click(await screen.findByRole('button', { name: '낮음 · 위협 없음' }))
    expect(onOpenPanel).toHaveBeenCalledTimes(1)
  })

  it('turnsSwitchOff_whenHtmlChanges', async () => {
    mockApi(() => view())
    const user = userEvent.setup()
    const { rerender } = renderWithProviders(<HtmlPreview html={SCRIPT_HTML} title="t" />)
    await user.click(sw())
    expect(sw()).toHaveAttribute('aria-checked', 'true')
    rerender(<HtmlPreview html={SCRIPT_HTML + '<!-- v2 -->'} title="t" />)
    expect(sw()).toHaveAttribute('aria-checked', 'false')
  })

  it('pollsAgainAfterRetry_whenPollingExhausted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let state: SecurityCheckView = view({ status: 'CHECKING' })
    const calls = mockApi(() => state, () => { state = view({ status: 'CHECKING' }); return state })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<HtmlPreview html={SCRIPT_HTML} title="t" securityCheckPath={PATH} />)
    await screen.findByText('AI 가 점검하는 중…')
    for (let i = 0; i < 45 && !screen.queryByRole('button', { name: '다시 점검' }); i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    }
    await user.click(await screen.findByRole('button', { name: '다시 점검' }))
    await waitFor(() => expect(calls.post).toBe(1))
    state = view({ status: 'DONE', risk: 'LOW' })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(await screen.findByText('낮음 · 위협 없음')).toBeInTheDocument()
  }, 30_000)

  // 안내 줄과 패널 카드가 같은 경로를 함께 볼 때 — 상한 도달 → 줄의 「다시 점검」 하나가 카드의 상한도 되돌린다.
  it('resetsCardAndNoticeTogether_whenRetryAfterPollingExhausted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let state: SecurityCheckView = view({ status: 'CHECKING' })
    const calls = mockApi(() => state, () => { state = view({ status: 'CHECKING' }); return state })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(
      <>
        <HtmlPreview html={SCRIPT_HTML} title="t" securityCheckPath={PATH} />
        <SecurityCheckCard path={PATH} />
      </>,
    )
    await screen.findAllByText('AI 가 점검하는 중…')
    for (let i = 0; i < 45 && !screen.queryByRole('button', { name: '다시 점검' }); i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    }
    // 줄·카드 모두 상한 도달 → 실패 문구.
    expect(screen.getAllByText('보안 점검을 하지 못했어요')).toHaveLength(2)
    await user.click(await screen.findByRole('button', { name: '다시 점검' }))
    await waitFor(() => expect(calls.post).toBe(1))
    // 카드도 진행 문구로 돌아온다(줄만 바뀌고 카드는 실패로 남지 않는다).
    await waitFor(() => expect(screen.getAllByText('AI 가 점검하는 중…')).toHaveLength(2))
    state = view({ status: 'DONE', risk: 'LOW' })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    // 줄의 칩은 「낮음 · 위협 없음」, 카드의 칩은 위험도만.
    await waitFor(() => {
      expect(screen.getByText('낮음 · 위협 없음')).toBeInTheDocument()
      expect(screen.getByText('낮음')).toBeInTheDocument()
    })
  }, 30_000)
})

// WP-1321: 뷰어는 AI 사이드 패널을 열면 본문을 다시 붙인다 — 허용 상태를 호출부가 들면 다시 붙어도 켜진 채다.
describe('HtmlPreview 허용 상태를 호출부가 들 때', () => {
  it('keepsScriptsAllowed_whenRemountedWithControlledState', async () => {
    let allowed: string | null = null
    const onChange = vi.fn((v: string | null) => { allowed = v })
    const user = userEvent.setup()
    const first = renderWithProviders(<HtmlPreview html={SCRIPT_HTML} title="t" allowedHtml={allowed} onAllowedHtmlChange={onChange} />)
    await user.click(sw())
    expect(onChange).toHaveBeenLastCalledWith(SCRIPT_HTML)
    // 다시 붙인다(뷰어의 modal 전환과 같다) — 호출부가 든 값으로 켜진 채 그린다.
    first.unmount()
    renderWithProviders(<HtmlPreview html={SCRIPT_HTML} title="t" allowedHtml={allowed} onAllowedHtmlChange={onChange} />)
    expect(sw()).toHaveAttribute('aria-checked', 'true')
    expect(sandbox()).toContain('allow-scripts')
    await user.click(sw())
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('blocksScripts_whenControlledHtmlDiffersFromDocument', () => {
    // 허용한 문서와 지금 문서가 다르면(다시 받아 내용이 바뀜) 다시 차단한다.
    renderWithProviders(<HtmlPreview html={SCRIPT_HTML} title="t" allowedHtml="<script>old</script>" onAllowedHtmlChange={() => {}} />)
    expect(sw()).toHaveAttribute('aria-checked', 'false')
    expect(sandbox()).not.toContain('allow-scripts')
  })
})
