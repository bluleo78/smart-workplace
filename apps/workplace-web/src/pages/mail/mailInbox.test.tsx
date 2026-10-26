// 받은편지함(목록·상세·검색·동기화·보기·회신필요·AI 요약 카드) — 화면 테스트(WP-984, WP-995).
// 목록 쿼리 파라미터·빈 상태 문구·배지·읽음 반영·딥링크 선택·계정 전환·동기화 토스트는 브라우저 없이 판정되므로
// e2e/pages/mail/mail-inbox.spec.ts·mail.spec.ts 에서 옮겼다. 메일 화면 배선(@wiring)·좁은 화면 마스터-디테일·다운로드·
// iframe 이미지 디코딩·새 탭 링크·다크 본문 색·행 막대/토글 기하는 mail-inbox.spec.ts 의 E2E 가 지킨다.
// 메일 모듈(사이드바 + 받은편지함 + 작성 도크)만 renderScreen 으로 띄운다(testkit-b4).
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import type { EmailMessageSummary } from '@/types/mailMessage'

import { detail, mailAccount, summary } from '../../../e2e/factories/mail.factory'
import { record, renderMail, unreadCounts } from './testkit-b4'

const LIST = '/api/v1/mail/accounts/1/messages'

afterEach(() => {
  vi.useRealTimers()
})

/** 목록 두 건(10: 첨부·안 읽음, 11: 밥·읽음) — query 파라미터가 있으면 제목·발신자로 거른다(E2E stubMessages 와 같음). */
const twoRows = (): EmailMessageSummary[] => [
  summary(),
  summary({ id: 11, fromName: '밥', fromAddress: 'bob@example.com', subject: '점심 메뉴', snippet: '오늘 점심 뭐 드실래요', seen: true, hasAttachment: false }),
]
const searchableList = () =>
  record('get', LIST, ({ url }) => {
    const q = url.searchParams.get('query')?.toLowerCase() ?? ''
    const all = twoRows()
    const items = q
      ? all.filter((m) => [m.subject, m.fromName, m.fromAddress].some((s) => (s ?? '').toLowerCase().includes(q)))
      : all
    return HttpResponse.json(items)
  })

const detailHandler = (id = 10, over: Parameters<typeof detail>[0] = {}) =>
  http.get(`/api/v1/mail/messages/${id}`, () => HttpResponse.json(detail({ id, ...over })))

// ── 목록·검색 ─────────────────────────────────────────────

test('메일 행 accessible name 은 발신자+제목만이고 스니펫은 빠진다(#699)', async () => {
  renderMail('/mail/1', { messages: twoRows() })
  const row = await screen.findByTestId('mail-row-10')
  expect(row).toHaveAccessibleName('앨리스 프로젝트 회의 안내')
  expect(row.getAttribute('aria-label')).not.toContain('내일 오후 2시에 회의를 진행합니다')
})

test('검색어를 넣으면 query 파라미터로 다시 받아 걸러진 목록만 보인다', async () => {
  const list = searchableList()
  const { user } = renderMail('/mail/1', { handlers: [list.handler] })
  await screen.findByTestId('mail-row-11')
  expect(screen.getByTestId('mail-row-10')).toBeInTheDocument()
  await user.click(screen.getByTestId('mail-search'))
  await user.paste('점심')
  // 새 검색 결과가 그려질 때까지(요청 중엔 목록이 잠깐 비어 10 이 사라진 것처럼 보인다) 두 조건을 함께 기다린다.
  await waitFor(() => {
    expect(screen.queryByTestId('mail-row-10')).not.toBeInTheDocument()
    expect(screen.getByTestId('mail-row-11')).toBeInTheDocument()
  })
  expect(list.last().url.searchParams.get('query')).toBe('점심')
})

test('검색은 키 입력마다 다시 부르지 않고 300ms 디바운스 뒤 1회만 부른다(#814)', async () => {
  const list = record('get', LIST, () => HttpResponse.json([]))
  const { location } = renderMail('/mail/1', { handlers: [list.handler] })
  const search = await screen.findByTestId('mail-search')
  await waitFor(() => expect(list.calls.length).toBeGreaterThan(0))
  const initial = list.calls.length
  // 디바운스 타이머만 가상 시계로 돌린다 — 글자마다 onChange 가 나가게 접두어를 차례로 넣는다(키 입력과 같음).
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  for (const v of ['l', 'lu', 'lun', 'lunc', 'lunch']) fireEvent.change(search, { target: { value: v } })
  act(() => vi.advanceTimersByTime(299))
  // 299ms 까지는 검색어가 주소(=목록 쿼리 키)로 넘어가지 않는다.
  expect(location()).not.toMatch(/q=/)
  expect(list.calls.length).toBe(initial)
  act(() => vi.advanceTimersByTime(1000))
  expect(location()).toMatch(/q=lunch/)
  vi.useRealTimers()
  // 글자 수만큼이 아니라 정확히 1건만 더 나간다.
  await waitFor(() => expect(list.calls.length).toBe(initial + 1))
  await act(() => new Promise((r) => setTimeout(r, 100)))
  expect(list.calls.length).toBe(initial + 1)
  expect(list.last().url.searchParams.get('query')).toBe('lunch')
})

test('snippet 없는 행은 미리보기 줄을 생략하고, 탭 제목은 「업무 · 메일」', async () => {
  renderMail('/mail/1', { messages: [summary(), summary({ id: 20, snippet: null })] })
  await screen.findByTestId('mail-row-20')
  expect(screen.getByTestId('mail-snippet-10')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-snippet-20')).not.toBeInTheDocument()
  await waitFor(() => expect(document.title).toBe('업무 · 메일 · Gen:iA Works'))
})

test('사이드바에 표준 LNB 타이틀 「메일」이 있다(#98)', async () => {
  renderMail('/mail/1', { messages: twoRows() })
  const sidebar = await screen.findByTestId('mail-sidebar')
  expect(within(sidebar).getByText('메일', { exact: true })).toBeInTheDocument()
})

// ── 계정 ─────────────────────────────────────────────

test('계정이 없으면 「계정 없음」 안내와 숨은 h1, 탭 제목은 화면 이름만', async () => {
  renderMail('/mail', { accounts: [] })
  expect(await screen.findByTestId('mail-empty-accounts')).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1, name: '메일' })).toBeInTheDocument()
  await waitFor(() => expect(document.title).toBe('메일 · Gen:iA Works'))
})

test.each(['/mail/99999', '/mail/abc', '/mail/99999?folder=drafts'])(
  '내 계정이 아닌 주소(%s)는 「찾을 수 없음」 안내, 목록 요청 없음(WP-926)',
  async (path) => {
    const list = record('get', '/api/v1/mail/accounts/:id/messages', () => HttpResponse.json(twoRows()))
    renderMail(path, { handlers: [list.handler] })
    expect(await screen.findByText('메일 계정을 찾을 수 없습니다')).toBeInTheDocument()
    expect(screen.queryByText('받은 메일이 없습니다. 동기화를 눌러보세요.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('메일 계정을 찾을 수 없음 · 메일 · Gen:iA Works'))
    expect(list.calls).toEqual([])
  },
)

test('「메일함으로 돌아가기」는 첫 계정 메일함으로 보낸다(WP-926)', async () => {
  const { user, location } = renderMail('/mail/99999', { messages: twoRows() })
  await user.click(await screen.findByRole('button', { name: '메일함으로 돌아가기' }))
  await waitFor(() => expect(location()).toBe('/mail/1'))
  expect(await screen.findByTestId('mail-row-10')).toBeInTheDocument()
})

test('계정이 없을 때 계정 주소로 들어오면 /mail 의 계정 없음 안내로 보낸다(WP-926)', async () => {
  const { location } = renderMail('/mail/99999', { accounts: [] })
  expect(await screen.findByTestId('mail-empty-accounts')).toBeInTheDocument()
  expect(location()).toBe('/mail')
})

// ── 상세 선택 ─────────────────────────────────────────────

test('?messageId 로 직접 들어오면 그 메일이 선택돼 상세가 열린다(#474)', async () => {
  renderMail('/mail/1?messageId=100', {
    messages: [summary({ id: 100, subject: '월간 보고서', snippet: '이번 달 실적을 공유합니다', seen: false })],
    handlers: [detailHandler(100, { subject: '월간 보고서', bodyText: '이번 달 실적을 공유합니다.' })],
  })
  expect(await screen.findByTestId('mail-detail')).toHaveTextContent('월간 보고서')
})

test('계정을 바꾸면 앞 계정의 선택이 풀리고 빈 상세 안내가 보인다(#474 회귀)', async () => {
  const { user, location } = renderMail('/mail/1?messageId=100', {
    accounts: [mailAccount(), mailAccount({ id: 2, emailAddress: 'work@example.com' })],
    handlers: [
      http.get(LIST, () => HttpResponse.json([summary({ id: 100, subject: '월간 보고서', seen: false })])),
      http.get('/api/v1/mail/accounts/2/messages', () => HttpResponse.json([])),
      detailHandler(100, { subject: '월간 보고서' }),
    ],
  })
  expect(await screen.findByTestId('mail-detail')).toHaveTextContent('월간 보고서')
  await user.click(screen.getByTestId('mail-account-switcher'))
  await user.click(await screen.findByTestId('mail-account-2'))
  await waitFor(() => expect(location()).toMatch(/^\/mail\/2/))
  const empty = await screen.findByTestId('mail-detail-empty')
  expect(empty).toHaveTextContent('메일을 선택하세요')
  expect(empty.querySelector('svg')).not.toBeNull()
})

test('메일을 열면 읽음 요청을 보내고 목록 행의 굵은 글씨·안 읽음 막대가 사라진다(#181·WP-155)', async () => {
  const read = record('post', '/api/v1/mail/messages/10/read')
  const { user } = renderMail('/mail/1', { messages: twoRows(), handlers: [detailHandler(), read.handler] })
  const row = await screen.findByTestId('mail-row-10')
  expect(row.querySelector('.font-semibold')).not.toBeNull()
  expect(screen.getByTestId('mail-unread-bar-10')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-unread-bar-11')).not.toBeInTheDocument()
  await user.click(row)
  await screen.findByTestId('mail-detail')
  await waitFor(() => expect(read.calls).toHaveLength(1))
  await waitFor(() => expect(screen.getByTestId('mail-row-10').querySelector('.font-semibold')).toBeNull())
  expect(screen.queryByTestId('mail-unread-bar-10')).not.toBeInTheDocument()
})

test('상세의 답장·전체답장·전달은 버튼이고, 답장을 누르면 인용문이 든 작성 도크가 열린다(#265)', async () => {
  const { user } = renderMail('/mail/1', { messages: twoRows(), handlers: [detailHandler()] })
  await user.click(await screen.findByTestId('mail-row-10'))
  for (const id of ['mail-reply', 'mail-reply-all', 'mail-forward']) {
    expect(await screen.findByTestId(id)).toHaveRole('button')
  }
  await user.click(screen.getByTestId('mail-reply'))
  expect(await screen.findByTestId('mail-compose-dock')).toBeInTheDocument()
  expect(screen.getByTestId('mail-compose-quote')).toBeInTheDocument()
  await user.click(screen.getByTestId('mail-compose-quote-toggle'))
  expect(await screen.findByTestId('mail-compose-quote-frame')).toBeInTheDocument()
})

// ── 본문·첨부 ─────────────────────────────────────────────

test('인라인 이미지 조회가 실패하면 그 첨부는 목록에 남고 본문 참조는 원문(cid:) 그대로(WP-70)', async () => {
  const contents = record('get', '/api/v1/mail/attachments/5/content', () => HttpResponse.json({ message: '없음' }, { status: 404 }))
  const { user } = renderMail('/mail/1', {
    messages: twoRows(),
    handlers: [
      contents.handler,
      detailHandler(10, {
        bodyText: null,
        bodyHtml: '<p>안내</p><img id="inline" src="cid:7dc8b642.png">',
        attachments: [{ id: 5, filename: '7dc8b642.png', contentType: 'image/png', sizeBytes: 10, contentId: null }],
      }),
    ],
  })
  await user.click(await screen.findByTestId('mail-row-10'))
  expect(await screen.findByTestId('mail-attachment-open-5', {}, { timeout: 10_000 })).toBeInTheDocument()
  expect(screen.getByTestId('mail-body-html').getAttribute('srcdoc')).toContain('src="cid:7dc8b642.png"')
  expect(contents.calls.length).toBeGreaterThanOrEqual(1)
})

test('text 본문을 보이면 인라인 이미지 첨부는 목록에 남고 조회하지 않는다(WP-70)', async () => {
  const contents = record('get', '/api/v1/mail/attachments/:id/content', () => new HttpResponse(''))
  const { user } = renderMail('/mail/1', {
    messages: twoRows(),
    handlers: [
      contents.handler,
      detailHandler(10, {
        bodyText: '안내 본문',
        bodyHtml: '<p>안내</p><img src="cid:7dc8b642.png">',
        attachments: [{ id: 5, filename: '7dc8b642.png', contentType: 'image/png', sizeBytes: 10, contentId: null }],
      }),
    ],
  })
  await user.click(await screen.findByTestId('mail-row-10'))
  expect(await screen.findByText('안내 본문')).toBeInTheDocument()
  expect(screen.getByTestId('mail-attachment-open-5')).toBeInTheDocument()
  expect(contents.calls).toHaveLength(0)
})

// ── 동기화 ─────────────────────────────────────────────

const syncHandler = (reply: () => void = () => {}, result = { fetched: 2, saved: 2 }) =>
  record('post', '/api/v1/mail/accounts/1/sync', () => {
    reply()
    return HttpResponse.json(result)
  })

test('동기화 버튼 → sync 호출 후 「새 메일 2건을 받았습니다」 토스트', async () => {
  const sync = syncHandler()
  const { user } = renderMail('/mail/1', { messages: twoRows(), handlers: [sync.handler] })
  await user.click(await screen.findByTestId('mail-sync'))
  await waitFor(() => expect(sync.calls).toHaveLength(1))
  expect(await screen.findByText('새 메일 2건을 받았습니다')).toBeInTheDocument()
})

test('동기화 중 본문 보충 진행률(BODIES 1/2)을 보이다가 끝나면 진행 바가 사라진다', async () => {
  let done = false
  const sync = syncHandler()
  const { user } = renderMail('/mail/1', {
    messages: twoRows(),
    handlers: [
      sync.handler,
      http.get('/api/v1/mail/accounts/1/sync-status', () =>
        HttpResponse.json(done ? { phase: 'IDLE', total: 2, done: 2, running: false } : { phase: 'BODIES', total: 2, done: 1, running: true }),
      ),
    ],
  })
  await user.click(await screen.findByTestId('mail-sync'))
  expect(await screen.findByTestId('mail-sync-progress')).toHaveTextContent('본문 1/2')
  done = true
  await waitFor(() => expect(screen.queryByTestId('mail-sync-progress')).not.toBeInTheDocument(), { timeout: 5000 })
})

test('툴바에 「2분 전」 동기화 시각이 보이고, 새로고침 아이콘이 sync 를 부른다(#481)', async () => {
  const sync = syncHandler(undefined, { fetched: 0, saved: 0 })
  const { user } = renderMail('/mail/1', {
    accounts: [mailAccount({ lastSyncedAt: new Date(Date.now() - 2 * 60_000).toISOString() })],
    messages: twoRows(),
    handlers: [sync.handler],
  })
  expect(await screen.findByTestId('mail-synced-at')).toHaveTextContent('2분 전')
  expect(screen.getByTestId('mail-synced-at').querySelector('.bg-green-500')).not.toBeNull()
  await user.click(screen.getByTestId('mail-sync'))
  await waitFor(() => expect(sync.calls).toHaveLength(1))
})

test('lastSyncedAt=null 이면 「동기화 안 됨」이고 녹색 점이 없으며, 동기화하면 계정을 다시 받아 「동기화됨」(#481)', async () => {
  let synced = false
  const sync = syncHandler(() => (synced = true), { fetched: 1, saved: 1 })
  const { user } = renderMail('/mail/1', {
    messages: twoRows(),
    handlers: [
      sync.handler,
      http.get('/api/v1/mail/accounts', () => HttpResponse.json([mailAccount({ lastSyncedAt: synced ? new Date().toISOString() : null })])),
    ],
  })
  const at = await screen.findByTestId('mail-synced-at')
  expect(at).toHaveTextContent('동기화 안 됨')
  expect(at.querySelector('.bg-green-500')).toBeNull()
  await user.click(screen.getByTestId('mail-sync'))
  await waitFor(() => expect(screen.getByTestId('mail-synced-at')).toHaveTextContent('동기화됨'))
  expect(screen.getByTestId('mail-synced-at')).not.toHaveTextContent('동기화 안 됨')
})

// ── 보기·안 읽은 메일만(WP-186) ─────────────────────────────────────────────

const countsHandler = http.get('/api/v1/mail/accounts/1/unread-counts', () =>
  HttpResponse.json(unreadCounts({ inbox: 4, byCategory: { 업무: 2, 개인: 1, 알림: 1, 프로모션: 0, 뉴스레터: 0 } })),
)

test('헤더는 받은편지함 › 업무, 분류 전 배지는 분류 대기 행에만, 토글을 켜면 unread=true 로 다시 받는다', async () => {
  const list = record('get', LIST, () =>
    HttpResponse.json([summary({ id: 10, categoryPending: true }), summary({ id: 11, aiCategory: '업무', seen: true })]),
  )
  const { user, location } = renderMail('/mail/1', { handlers: [countsHandler, list.handler] })
  expect(await screen.findByTestId('mail-badge-pending-10')).toHaveTextContent('분류 전')
  expect(screen.getByTestId('page-header')).toHaveTextContent('받은편지함')
  expect(screen.getByTestId('page-header')).toHaveTextContent('업무')
  expect(screen.queryByTestId('mail-badge-pending-11')).not.toBeInTheDocument()
  await user.click(screen.getByTestId('mail-unread-toggle'))
  await waitFor(() => expect(location()).toMatch(/unread=true/))
  expect(screen.getByTestId('mail-unread-toggle')).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(list.last().url.searchParams.get('unread')).toBe('true'))
})

test('안 읽은 메일만 + 메일 열기 → 재조회에서 빠져도 남고, 보기를 바꾸면 빠진다', async () => {
  let opened = false
  const list = record('get', LIST, () => HttpResponse.json(opened ? [summary({ id: 11 })] : [summary({ id: 10 }), summary({ id: 11 })]))
  const read = record('post', '/api/v1/mail/messages/10/read')
  const { user, queryClient } = renderMail('/mail/1?unread=true', { handlers: [countsHandler, list.handler, read.handler, detailHandler()] })
  await user.click(await screen.findByTestId('mail-row-10'))
  await waitFor(() => expect(read.calls).toHaveLength(1))
  opened = true
  const before = list.calls.length
  // 60초 주기 재조회와 같은 재조회를 일으킨다 — 요청이 나갔는지 먼저 확인한다.
  await act(() => queryClient.refetchQueries({ type: 'active' }))
  await waitFor(() => expect(list.calls.length).toBeGreaterThan(before))
  expect(screen.getByTestId('mail-row-10')).toBeInTheDocument()
  await user.click(screen.getByTestId('mail-filter-category-개인'))
  await user.click(screen.getByTestId('mail-filter-category-업무'))
  await waitFor(() => expect(screen.queryByTestId('mail-row-10')).not.toBeInTheDocument())
})

test('안 읽은 메일만 — 상세 조회 전에 재조회가 10 을 빼도 목록에 남는다(WP-230)', async () => {
  let opened = false
  const list = record('get', LIST, () => HttpResponse.json(opened ? [summary({ id: 11 })] : [summary({ id: 10 }), summary({ id: 11 })]))
  let releaseDetail!: () => void
  const gate = new Promise<void>((r) => (releaseDetail = r))
  const details = record('get', '/api/v1/mail/messages/10', async () => {
    await gate
    return HttpResponse.json(detail())
  })
  const read = record('post', '/api/v1/mail/messages/10/read')
  const { user, queryClient } = renderMail('/mail/1?unread=true', { handlers: [countsHandler, list.handler, details.handler, read.handler] })
  await user.click(await screen.findByTestId('mail-row-10'))
  await waitFor(() => expect(details.calls).toHaveLength(1))
  opened = true
  const before = list.calls.length
  await act(() => queryClient.refetchQueries({ queryKey: ['mail-messages'] }))
  await waitFor(() => expect(list.calls.length).toBeGreaterThan(before))
  await act(() => new Promise((r) => setTimeout(r, 100)))
  expect(screen.getByTestId('mail-row-10')).toBeInTheDocument()
  releaseDetail()
  await waitFor(() => expect(read.calls).toHaveLength(1))
  await act(() => new Promise((r) => setTimeout(r, 100)))
  expect(screen.getByTestId('mail-row-10')).toBeInTheDocument()
})

test('안 읽은 메일만 — 상세 도착 전에 다른 메일로 옮긴 메일은 유지하지 않는다(WP-230)', async () => {
  let readElsewhere = false
  const list = record('get', LIST, () => HttpResponse.json(readElsewhere ? [summary({ id: 11 })] : [summary({ id: 10 }), summary({ id: 11 })]))
  const { user, location, queryClient } = renderMail('/mail/1?unread=true', {
    handlers: [
      countsHandler,
      list.handler,
      // 10 의 상세는 끝내 오지 않는다 — 읽음 판정 전에 선택을 떠난 경우.
      http.get('/api/v1/mail/messages/10', () => new Promise<Response>(() => {})),
      detailHandler(11),
    ],
  })
  await user.click(await screen.findByTestId('mail-row-10'))
  await waitFor(() => expect(screen.getByTestId('mail-row-10')).toHaveAttribute('aria-current', 'true'))
  await user.click(screen.getByTestId('mail-row-11'))
  await waitFor(() => expect(location()).toMatch(/messageId=11/))
  readElsewhere = true
  const before = list.calls.length
  await act(() => queryClient.refetchQueries({ type: 'active' }))
  await waitFor(() => expect(list.calls.length).toBeGreaterThan(before))
  await waitFor(() => expect(screen.queryByTestId('mail-row-10')).not.toBeInTheDocument())
  expect(screen.getByTestId('mail-row-11')).toBeInTheDocument()
})

test('토글 off→on 으로 돌아와도 읽은 메일은 되살아나지 않는다', async () => {
  let opened = false
  const list = record('get', LIST, ({ url }) => {
    const unread = url.searchParams.get('unread') === 'true'
    return HttpResponse.json(unread && opened ? [summary({ id: 11 })] : [summary({ id: 10 }), summary({ id: 11 })])
  })
  const read = record('post', '/api/v1/mail/messages/10/read')
  const { user, location, queryClient } = renderMail('/mail/1?unread=true', { handlers: [countsHandler, list.handler, read.handler, detailHandler()] })
  await user.click(await screen.findByTestId('mail-row-10'))
  await waitFor(() => expect(read.calls).toHaveLength(1))
  opened = true
  await user.click(screen.getByTestId('mail-unread-toggle')) // off
  await waitFor(() => expect(location()).not.toMatch(/unread=true/))
  expect(await screen.findByTestId('mail-row-10')).toBeInTheDocument()
  // staleTime 이 지난 것처럼 — 캐시된 옛 [10,11] 이 아니라 서버 응답 기준으로 본다.
  queryClient.invalidateQueries({ queryKey: ['mail-messages'] })
  await user.click(screen.getByTestId('mail-unread-toggle')) // on
  await waitFor(() => expect(location()).toMatch(/unread=true/))
  await waitFor(() => expect(screen.queryByTestId('mail-row-10')).not.toBeInTheDocument())
  expect(screen.getByTestId('mail-row-11')).toBeInTheDocument()
})

test('보낸편지함은 안 읽은 메일만 토글·분류 전 배지가 없다', async () => {
  renderMail('/mail/1?folder=sent', { handlers: [countsHandler], messages: [summary({ id: 10, categoryPending: true })] })
  await screen.findByTestId('mail-row-10')
  expect(screen.queryByTestId('mail-unread-toggle')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-badge-pending-10')).not.toBeInTheDocument()
})

test('보기별 빈 상태 문구 — 업무 + 안 읽은 메일만', async () => {
  renderMail('/mail/1?unread=true', { handlers: [countsHandler] })
  expect(await screen.findByTestId('mail-view-empty')).toHaveTextContent('업무 메일 중 안 읽은 메일이 없어요.')
})

// ── 사이드바 필터·회신필요(mail.spec) ─────────────────────────────────────────────

const aiAccount = [mailAccount({ aiEnabled: true })]

test('사이드바 회신필요 → URL needsReply=true, 목록 API 에 needsReply 를 싣는다', async () => {
  const list = record('get', LIST, () => HttpResponse.json([]))
  const { user, location } = renderMail('/mail/1', {
    accounts: aiAccount,
    handlers: [list.handler, http.get('/api/v1/mail/accounts/1/unread-counts', () => HttpResponse.json(unreadCounts({ inbox: 2, needsReply: 2 })))],
  })
  await user.click(await screen.findByTestId('mail-filter-needsreply'))
  await waitFor(() => expect(location()).toMatch(/needsReply=true/))
  await waitFor(() => expect(list.last().url.searchParams.get('needsReply')).toBe('true'))
})

test('사이드바 분류(개인) → URL category=개인, 목록 API 에 category 를 싣는다', async () => {
  const list = record('get', LIST, () => HttpResponse.json([]))
  const { user, location } = renderMail('/mail/1', { accounts: aiAccount, handlers: [list.handler] })
  await user.click(await screen.findByTestId('mail-filter-category-개인'))
  await waitFor(() => expect(decodeURIComponent(location())).toMatch(/category=개인/))
  await waitFor(() => expect(list.last().url.searchParams.get('category')).toBe('개인'))
})

test('회신필요 메일엔 배지만 있고 처리완료 버튼이 없다(WP-146)', async () => {
  renderMail('/mail/1?needsReply=true', {
    accounts: aiAccount,
    messages: [summary({ id: 10, subject: '검토 요청', aiCategory: '업무', aiNeedsReply: true, seen: false })],
  })
  expect(await screen.findByTestId('mail-badge-needsreply-10')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-resolve-10')).not.toBeInTheDocument()
})

test('회신필요 메일을 열면 배지가 사라지고 안 읽은 수를 다시 받아 0 이면 사이드바 항목도 사라진다', async () => {
  const counts = record('get', '/api/v1/mail/accounts/1/unread-counts', (_c, n) =>
    HttpResponse.json(unreadCounts(n === 1 ? { inbox: 1, needsReply: 1 } : {})),
  )
  const { user } = renderMail('/mail/1', {
    accounts: aiAccount,
    messages: [summary({ id: 10, subject: '검토 요청', aiCategory: '업무', aiNeedsReply: true, seen: false })],
    handlers: [counts.handler, detailHandler(10, { seen: false })],
  })
  await screen.findByTestId('mail-filter-needsreply')
  await user.click(await screen.findByTestId('mail-row-10'))
  await waitFor(() => expect(screen.queryByTestId('mail-badge-needsreply-10')).not.toBeInTheDocument())
  await waitFor(() => expect(counts.calls.length).toBeGreaterThanOrEqual(2))
  await waitFor(() => expect(screen.queryByTestId('mail-filter-needsreply')).not.toBeInTheDocument())
})

test('회신필요 0건 → 긍정 빈 상태', async () => {
  renderMail('/mail/1?needsReply=true', { accounts: aiAccount })
  expect(await screen.findByTestId('mail-needsreply-empty')).toBeInTheDocument()
})

test('분류(개인) 0건 → 중립 빈 상태만 보인다', async () => {
  renderMail(`/mail/1?category=${encodeURIComponent('개인')}`, { accounts: aiAccount })
  expect(await screen.findByTestId('mail-category-empty')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-list-empty')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-needsreply-empty')).not.toBeInTheDocument()
})

// ── AI 요약 카드(mail.spec) ─────────────────────────────────────────────

async function openFirstMail(aiEnabled: boolean, summaryHandler: NonNullable<Parameters<typeof renderMail>[1]>['handlers']) {
  const view = renderMail('/mail/1', {
    accounts: [mailAccount({ aiEnabled })],
    messages: [summary()],
    handlers: [detailHandler(), ...(summaryHandler ?? [])],
  })
  await view.user.click(await screen.findByTestId('mail-row-10'))
  await screen.findByTestId('mail-detail')
  return view
}

test('AI 요약은 응답 전엔 스켈레톤, 응답이 오면 요약 텍스트로 바뀐다', async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  await openFirstMail(true, [
    http.get('/api/v1/mail/messages/:id/summary', async () => {
      await gate
      return HttpResponse.json({ summary: '• 핵심 1\n• 핵심 2' })
    }),
  ])
  expect(await screen.findByTestId('mail-ai-summary-loading')).toBeInTheDocument()
  release()
  await waitFor(() => expect(screen.getByTestId('mail-ai-summary')).toHaveTextContent('핵심 1'))
  expect(screen.queryByTestId('mail-ai-summary-loading')).not.toBeInTheDocument()
})

test('개인 비서 OFF 계정 + 객관 요약 없음 → 카드·스켈레톤 모두 없다', async () => {
  const sum = record('get', '/api/v1/mail/messages/:id/summary', () => HttpResponse.json({ summary: null }))
  await openFirstMail(false, [sum.handler])
  await waitFor(() => expect(sum.calls.length).toBeGreaterThan(0))
  await act(() => new Promise((r) => setTimeout(r, 50)))
  expect(screen.queryByTestId('mail-ai-summary')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-ai-summary-loading')).not.toBeInTheDocument()
})

test('개인 비서 OFF 계정이어도 객관 요약이 있으면 카드를 보이고 스켈레톤은 없다', async () => {
  await openFirstMail(false, [http.get('/api/v1/mail/messages/:id/summary', () => HttpResponse.json({ summary: '• 객관 요약 텍스트' }))])
  expect(await screen.findByTestId('mail-ai-summary')).toHaveTextContent('객관 요약 텍스트')
  expect(screen.queryByTestId('mail-ai-summary-loading')).not.toBeInTheDocument()
})
