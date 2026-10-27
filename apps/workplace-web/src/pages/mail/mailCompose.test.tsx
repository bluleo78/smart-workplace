// 메일 작성 도크(발송·답장·크게 보기 상태)·인용문 보존(#765·WP-69)·초안 코칭(AI 검토) — 화면 테스트(WP-984, WP-995).
// 발송 payload(본문+인용문 순서·무손실·누출 차단·inlineImages)·답장 inReplyTo·크게 보기 상태 전환(배경·대화상자·inert)·
// ✕ 임시저장·검토 탭 비활성·코칭 요청/교체/503 안내는 브라우저 없이 판정되므로
// mail-compose.spec.ts·mail-quote.spec.ts·mail-coaching.spec.ts 에서 옮겼다.
// 남은 E2E: 도크 배선(@wiring), IME·포커스·Tab·단축키(@input), 크기·스크롤·겹침·AI 패널 배치·다크 색·토스트 위치(@layout),
// 인용 미리보기 이미지 디코딩(@platform).
// 메일 모듈 + 작성 도크만 renderScreen 으로 띄운다(testkit-b4). 본문(TipTap)은 클릭 뒤 키 입력으로 쓴다.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { SANDBOX_HEAD } from '@/lib/sandboxedHtml'
import { record, renderMail } from '@/test/kits/mail/testkit-b4'

import { detail, mailAccount, summary } from '../../../e2e/factories/mail.factory'

afterEach(() => {
  vi.restoreAllMocks()
})

type SendBody = {
  to: string[]
  subject: string
  bodyHtml: string
  bodyText: string
  inReplyToMessageId: number | null
  inlineImages?: { attachmentId: number; contentId: string }[]
}
const sendHandler = (reply?: () => Response) =>
  record<SendBody>('post', '/api/v1/mail/accounts/1/send', () => reply?.() ?? HttpResponse.json({ localMessageId: 10, messageId: 'x@test.local' }))
const draftPosts = () =>
  record<{ mode: string; sourceMessageId: number | null; quoteRemoved: boolean; bodyHtml: string }>('post', '/api/v1/mail/drafts', () =>
    HttpResponse.json({ id: 77, version: 1, updatedAt: '2026-10-21T01:00:00Z' }),
  )
const chips = (field: 'to' | 'cc') => screen.queryAllByTestId(`mail-compose-${field}-chip`).map((el) => el.getAttribute('data-value'))

/** 본문 에디터에 글을 쓴다 — 클릭으로 초점을 두고 키를 친다(ProseMirror 가 입력을 문서로 읽는다). */
async function typeBody(user: ReturnType<typeof renderMail>['user'], text: string) {
  await user.click(screen.getByTestId('mail-composer-body'))
  await user.keyboard(text)
}

/** 원문 한 건(id 5)을 열어 둔 메일함. */
function withSource(over: Parameters<typeof detail>[0] = {}, extra: NonNullable<Parameters<typeof renderMail>[1]>['handlers'] = []) {
  return renderMail('/mail/1', {
    handlers: [
      ...(extra ?? []),
      http.get('/api/v1/mail/accounts/1/messages', () => HttpResponse.json([summary({ id: 5, fromAddress: 'alice@example.com', fromName: 'Alice', subject: '원문' })])),
      http.get('/api/v1/mail/messages/5', () =>
        HttpResponse.json(detail({ id: 5, threadId: 't1', messageId: 'orig@x', fromAddress: 'alice@example.com', fromName: 'Alice', subject: '원문', bodyText: '원문 본문', bodyHtml: null, attachments: [], ...over })),
      ),
    ],
  })
}
async function openSource(view: ReturnType<typeof renderMail>) {
  await view.user.click(await screen.findByTestId('mail-row-5'))
  await screen.findByTestId('mail-reply')
}

// ── 작성·발송(mail-compose) ─────────────────────────────────────────────

test('서식 토글 — 굵게를 켜면 aria-pressed·켜짐 표시, 기울임은 그대로, 다시 누르면 꺼진다(WP-368)', async () => {
  const { user } = renderMail('/mail/1')
  await user.click(await screen.findByTestId('mail-compose-new'))
  await user.click(await screen.findByTestId('mail-composer-body'))
  const bold = screen.getByRole('button', { name: '굵게' })
  const italic = screen.getByRole('button', { name: '기울임' })
  expect(bold).toHaveAttribute('aria-pressed', 'false')
  await user.click(bold)
  await waitFor(() => expect(bold).toHaveAttribute('aria-pressed', 'true'))
  expect(bold.className).toMatch(/border-primary/)
  expect(italic).toHaveAttribute('aria-pressed', 'false')
  expect(italic.className).not.toMatch(/(?<![:\w-])border-primary/)
  await user.click(bold)
  await waitFor(() => expect(bold).toHaveAttribute('aria-pressed', 'false'))
})

test('답장 → 받는사람은 발신자 칩, 제목 Re:, inReplyToMessageId 를 싣는다', async () => {
  const send = sendHandler()
  const view = withSource({}, [send.handler])
  await openSource(view)
  await view.user.click(screen.getByTestId('mail-reply'))
  await waitFor(() => expect(chips('to')).toEqual(['alice@example.com']))
  await view.user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(send.calls).toHaveLength(1))
  expect(send.last().body.inReplyToMessageId).toBe(5)
  expect(send.last().body.subject).toMatch(/^Re:/)
  expect(send.last().body.to).toEqual(['alice@example.com'])
})

test('인용문만 지워도 ✕ 는 임시저장(quoteRemoved)하고, 크게 보기에서 고친 제목·본문은 인용문을 지워도 그대로 발송된다', async () => {
  const send = sendHandler()
  const drafts = draftPosts()
  const view = withSource({ bodyText: '기밀 원문' }, [send.handler, drafts.handler])
  const { user } = view
  await openSource(view)
  await user.click(screen.getByTestId('mail-reply'))
  await user.click(await screen.findByTestId('mail-compose-quote-remove'))
  await user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  await waitFor(() => expect(drafts.calls).toHaveLength(1))
  expect(drafts.last().body).toMatchObject({ mode: 'reply', sourceMessageId: 5, quoteRemoved: true })
  expect(await screen.findByText('임시보관함에 저장했어요')).toBeInTheDocument()

  await user.click(screen.getByTestId('mail-reply'))
  await user.click(await screen.findByRole('button', { name: '크게 보기' }))
  fireEvent.change(screen.getByTestId('mail-compose-subject'), { target: { value: '고친 제목' } })
  await typeBody(user, '직접 쓴 회신')
  await user.click(screen.getByTestId('mail-compose-quote-remove'))
  expect(screen.queryByTestId('mail-compose-quote')).not.toBeInTheDocument()
  expect(screen.getByTestId('mail-compose-backdrop')).toBeInTheDocument()
  expect(screen.getByTestId('mail-compose-subject')).toHaveValue('고친 제목')
  await user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(send.calls).toHaveLength(1))
  expect(send.last().body.subject).toBe('고친 제목')
  expect(send.last().body.bodyText).toContain('직접 쓴 회신')
  expect(send.last().body.bodyText).not.toContain('기밀 원문')
})

test('메일 모듈을 떠났다 돌아와도 작성 도크와 쓰던 받는사람·제목이 남는다(#183)', async () => {
  const { user, location } = renderMail('/mail/1')
  await user.click(await screen.findByTestId('mail-compose-new'))
  await user.click(screen.getByTestId('mail-compose-to'))
  await user.paste('draft@example.com')
  // 칸을 떠나면 쓰던 주소가 칩으로 굳는다(앱 레일을 누르는 것과 같다).
  await user.click(screen.getByTestId('mail-compose-subject'))
  await user.paste('Draft survival test')
  // 앱 안 이동(다른 모듈) — 메일 레이아웃은 내려가도 도크는 앱 전역에 남는다.
  act(() => {
    window.history.pushState(null, '', '/projects')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  expect(await screen.findByTestId('outside-mail')).toBeInTheDocument()
  expect(location()).toBe('/projects')
  expect(screen.getByTestId('mail-compose-dock')).toBeInTheDocument()
  act(() => {
    window.history.pushState(null, '', '/mail/1')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  expect(await screen.findByTestId('mail-sidebar')).toBeInTheDocument()
  expect(chips('to')).toEqual(['draft@example.com'])
  expect(screen.getByTestId('mail-compose-subject')).toHaveValue('Draft survival test')
})

test('보낸편지함을 누르면 목록을 folder=SENT 로 받는다', async () => {
  const list = record('get', '/api/v1/mail/accounts/1/messages', () => HttpResponse.json([]))
  const { user } = renderMail('/mail/1', { handlers: [list.handler] })
  await user.click(await screen.findByTestId('mail-folder-sent'))
  await waitFor(() => expect(list.calls.map((c) => c.url.searchParams.get('folder'))).toContain('SENT'))
})

// ── 크게 보기 상태(mail-compose WP-575) ─────────────────────────────────────────────

async function openNewExpanded() {
  const view = renderMail('/mail/1')
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  await screen.findByTestId('mail-compose-dock')
  return view
}
const expandBtn = () => screen.getByRole('button', { name: '크게 보기' })
const isPageInert = () => (screen.getByTestId('mail-compose-new').closest('[data-ai-page-root] > *') as HTMLElement).inert === true

test('크게 보기는 대화상자(aria-modal 없음)이고 뒤 페이지를 inert 로, 작게 보면 region 으로 돌아가며 풀린다', async () => {
  const { user } = await openNewExpanded()
  const dock = screen.getByTestId('mail-compose-dock')
  expect(dock).toHaveAttribute('role', 'region')
  expect(isPageInert()).toBe(false)
  await user.click(expandBtn())
  await waitFor(() => expect(dock).toHaveAttribute('role', 'dialog'))
  expect(dock).not.toHaveAttribute('aria-modal')
  expect(screen.getByTestId('mail-compose-backdrop')).toBeInTheDocument()
  expect(isPageInert()).toBe(true)
  await user.click(screen.getByRole('button', { name: '작게 보기' }))
  await waitFor(() => expect(dock).toHaveAttribute('role', 'region'))
  expect(screen.queryByTestId('mail-compose-backdrop')).not.toBeInTheDocument()
  expect(isPageInert()).toBe(false)
})

test('확대 중 Esc 는 닫지 않고 작은 창으로 돌아가며 쓰던 제목·본문을 유지한다', async () => {
  const { user } = await openNewExpanded()
  fireEvent.change(screen.getByTestId('mail-compose-subject'), { target: { value: '확대 중 제목' } })
  await user.click(expandBtn())
  await typeBody(user, '확대 본문')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('mail-compose-backdrop')).not.toBeInTheDocument())
  expect(screen.getByTestId('mail-compose-dock')).toHaveAttribute('role', 'region')
  expect(screen.getByTestId('mail-compose-subject')).toHaveValue('확대 중 제목')
  expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('확대 본문')
})

test('확대 중 배경을 누르면 닫지 않고 작은 창으로, 쓰던 주소는 칩으로 굳는다', async () => {
  const { user } = await openNewExpanded()
  await user.click(screen.getByTestId('mail-compose-to'))
  await user.paste('keep@test.local')
  await user.click(expandBtn())
  await user.click(screen.getByTestId('mail-compose-backdrop'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-backdrop')).not.toBeInTheDocument())
  expect(screen.getByTestId('mail-compose-dock')).toHaveAttribute('role', 'region')
  await waitFor(() => expect(chips('to')).toEqual(['keep@test.local']))
})

test('확대 중 최소화하면 작은 창의 최소화(본문 숨김)가 되고, 다시 펼치면 작은 창이다', async () => {
  const { user } = await openNewExpanded()
  await user.click(expandBtn())
  await user.click(screen.getByRole('button', { name: '최소화' }))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-backdrop')).not.toBeInTheDocument())
  // 최소화는 본문 영역에 hidden 을 걸어 숨긴다(에디터는 다시 만들지 않는다).
  expect(screen.getByTestId('mail-compose-to').closest('.hidden')).not.toBeNull()
  expect(expandBtn()).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '최소화' }))
  await waitFor(() => expect(screen.getByTestId('mail-compose-to').closest('.hidden')).toBeNull())
  expect(screen.queryByTestId('mail-compose-backdrop')).not.toBeInTheDocument()
  expect(screen.getByTestId('mail-compose-dock')).toHaveAttribute('role', 'region')
})

test('확대한 채 닫았다 다시 열면 작은 창으로 열린다', async () => {
  const { user } = await openNewExpanded()
  await user.click(expandBtn())
  await user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  await user.click(screen.getByTestId('mail-compose-new'))
  expect(await screen.findByTestId('mail-compose-dock')).toHaveAttribute('role', 'region')
  expect(screen.queryByTestId('mail-compose-backdrop')).not.toBeInTheDocument()
})

test('크게 보기에서도 ✕ 는 묻지 않고 임시저장한 뒤 닫고 배경도 걷힌다(WP-577)', async () => {
  const drafts = draftPosts()
  const view = renderMail('/mail/1', { handlers: [drafts.handler] })
  const { user } = view
  await user.click(await screen.findByTestId('mail-compose-new'))
  await user.click(await screen.findByRole('button', { name: '크게 보기' }))
  await typeBody(user, '지우면 안 되는 본문')
  await user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  expect(screen.queryByTestId('mail-compose-backdrop')).not.toBeInTheDocument()
  await waitFor(() => expect(drafts.calls).toHaveLength(1))
  expect(drafts.last().body.bodyHtml).toContain('지우면 안 되는 본문')
  expect(await screen.findByText('임시보관함에 저장했어요')).toBeInTheDocument()
})

test('크게 보기에서 AI 검토 탭을 열면 에디터·서식 버튼은 숨고 검토 패널만 보인다', async () => {
  const coach = record('post', '/api/v1/mail/draft-coaching', () => HttpResponse.json({ notes: [], improvedBodyHtml: '<p>개선본</p>' }))
  const view = renderMail('/mail/1', { handlers: [coach.handler] })
  const { user } = view
  await user.click(await screen.findByTestId('mail-compose-new'))
  await user.click(await screen.findByRole('button', { name: '크게 보기' }))
  await typeBody(user, '검토할 본문')
  await user.click(screen.getByTestId('mail-review-tab'))
  expect(await screen.findByTestId('mail-coaching-panel')).toBeInTheDocument()
  expect(screen.getByTestId('mail-composer-body').closest('.hidden')).not.toBeNull()
  expect(screen.getByTestId('mail-composer-toolbar').closest('.hidden')).not.toBeNull()
})

// ── 인용문 보존(mail-quote, #765) ─────────────────────────────────────────────

/** 실제 메일처럼 완전 문서 + 표 + 인라인 style + 서명. */
const FULL_DOC_BODY = [
  '<html><head><style>body{color:red;font-family:Papyrus}</style></head><body>',
  '<p>안녕하세요, 인프라팀입니다.</p>',
  '<table><tr><th>항목</th><th>4분기(안)</th></tr>',
  '<tr><td bgcolor="#eeeeee" style="color:#0000ff">스토리지</td><td>25,900</td></tr></table>',
  '<p><font color="red">박지원 · 인프라팀 · 010-0000-0000</font></p>',
  '</body></html>',
].join('')

async function openQuoteMail(extra: NonNullable<Parameters<typeof renderMail>[1]>['handlers'] = []) {
  const view = withSource(
    { subject: '4분기 인프라 예산 재검토 요청', fromName: '박지원', fromAddress: 'jiwon.park@test.local', bodyHtml: FULL_DOC_BODY, bodyText: null },
    extra,
  )
  await openSource(view)
  return view
}

test('답장 인용문은 기본 접힘, 펼치면 표·서식은 그대로이고 원문 스타일·문서 래퍼는 새지 않으며 격리 머리말이 붙는다', async () => {
  const { user } = await openQuoteMail()
  await user.click(screen.getByTestId('mail-reply'))
  const quote = await screen.findByTestId('mail-compose-quote')
  expect(quote).not.toHaveAttribute('open')
  await user.click(screen.getByTestId('mail-compose-quote-toggle'))
  await waitFor(() => expect(quote).toHaveAttribute('open'))
  const srcDoc = screen.getByTestId('mail-compose-quote-frame').getAttribute('srcdoc')!
  expect(srcDoc).toContain('<table>')
  expect(srcDoc).toContain('bgcolor="#eeeeee"')
  expect(srcDoc).toContain('style="color:#0000ff"')
  expect(srcDoc).toContain('<font color="red">')
  // 슬림 스크롤바·링크 base(WP-275·WP-427)를 담은 공용 머리말이 붙는다 — 그 문자열 하나만 빼고 누출을 본다.
  expect(srcDoc).toContain(SANDBOX_HEAD)
  const original = srcDoc.replace(SANDBOX_HEAD, '')
  for (const leak of ['<style', 'Papyrus', '<html', '<head']) expect(original).not.toContain(leak)
})

test('높이 토글(전체 높이)이 펼침 상태를 무너뜨리지 않는다', async () => {
  const { user } = await openQuoteMail()
  await user.click(screen.getByTestId('mail-reply'))
  await user.click(await screen.findByTestId('mail-compose-quote-toggle'))
  await user.click(screen.getByText('전체 높이', { exact: true }))
  expect(screen.getByTestId('mail-compose-quote-frame').className).toMatch(/h-64/)
  expect(screen.getByTestId('mail-compose-quote')).toHaveAttribute('open')
})

test('전달 인용문은 기본 펼침이고 카드에 제목·발신자가 보이며, 접은 뒤엔 접힌 채다', async () => {
  const { user } = await openQuoteMail()
  await user.click(screen.getByTestId('mail-forward'))
  const quote = await screen.findByTestId('mail-compose-quote')
  expect(quote).toHaveAttribute('open')
  expect(screen.getByTestId('mail-compose-quote-frame')).toBeInTheDocument()
  expect(quote).toHaveTextContent('4분기 인프라 예산 재검토 요청')
  expect(quote).toHaveTextContent('박지원')
  await user.click(screen.getByTestId('mail-compose-quote-toggle'))
  await waitFor(() => expect(quote).not.toHaveAttribute('open'))
})

test('발송 payload 는 에디터 본문 + 인용문 순서이고 원문 무손실·누출 없음, 텍스트 대안에도 인용 머리가 실린다', async () => {
  const send = sendHandler()
  const { user } = await openQuoteMail([send.handler])
  await user.click(screen.getByTestId('mail-reply'))
  await typeBody(user, '스토리지 항목만 조정하면 될 것 같습니다.')
  await user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(send.calls).toHaveLength(1))
  const { bodyHtml: html, bodyText } = send.last().body
  expect(html.indexOf('스토리지 항목만')).toBeLessThan(html.indexOf('<blockquote>'))
  expect(html.indexOf('스토리지 항목만')).toBeGreaterThanOrEqual(0)
  expect(html).toContain('<table>')
  expect(html).toContain('bgcolor="#eeeeee"')
  for (const leak of ['<style', 'Papyrus', '<html', '<head']) expect(html).not.toContain(leak)
  expect(bodyText).toContain('박지원 님이 작성:')
  expect(bodyText).toContain('>')
})

test('본문 없이도 답장은 보낼 수 있지만 AI 검토는 비활성, 새 메일엔 인용문이 없고 검토도 비활성', async () => {
  const { user } = await openQuoteMail()
  await user.click(screen.getByTestId('mail-reply'))
  expect(await screen.findByTestId('mail-compose-send')).toBeEnabled()
  expect(screen.getByTestId('mail-review-tab')).toBeDisabled()
  await user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  await user.click(screen.getByTestId('mail-compose-new'))
  await screen.findByTestId('mail-compose-dock')
  expect(screen.queryByTestId('mail-compose-quote')).not.toBeInTheDocument()
  expect(screen.getByTestId('mail-review-tab')).toBeDisabled()
})

test('인용문 제거 버튼으로 지우면 블록이 사라지고 발송 payload 에 인용문이 없다', async () => {
  const send = sendHandler()
  const { user } = await openQuoteMail([send.handler])
  await user.click(screen.getByTestId('mail-reply'))
  await user.click(await screen.findByTestId('mail-compose-quote-remove'))
  expect(screen.queryByTestId('mail-compose-quote')).not.toBeInTheDocument()
  await typeBody(user, '기밀 문단 없이 회신합니다.')
  await user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(send.calls).toHaveLength(1))
  expect(send.last().body.bodyHtml).not.toContain('<blockquote>')
  expect(send.last().body.bodyHtml).toContain('기밀 문단 없이 회신합니다.')
})

test('인용문 있는 전달에서 형제 컴포넌트 key 중복 경고가 나지 않는다(#831)', async () => {
  const errors = vi.spyOn(console, 'error')
  const { user } = await openQuoteMail()
  await user.click(screen.getByTestId('mail-forward'))
  await screen.findByTestId('mail-compose-quote')
  const dup = errors.mock.calls.map((c) => c.map(String).join(' ')).filter((m) => /two children with the same key/i.test(m))
  expect(dup).toEqual([])
})

// ── 인용문 인라인 이미지(mail-quote, WP-69) ─────────────────────────────────────────────

async function openInlineMail(extra: NonNullable<Parameters<typeof renderMail>[1]>['handlers'] = []) {
  const view = withSource(
    {
      subject: '킥오프 참석자 조사',
      fromName: '남태현',
      fromAddress: 'thnam@test.local',
      bodyText: null,
      bodyHtml: '<p>회신 부탁드립니다.</p><img id="q-inline" src="cid:7dc8b642.png"><img id="q-gone" src="cid:none.png">',
      attachments: [
        { id: 21, filename: '7dc8b642.png', contentType: 'image/png', sizeBytes: 4, contentId: null },
        { id: 22, filename: '참석자조사.xlsx', contentType: 'application/vnd.ms-excel', sizeBytes: 100, contentId: null },
      ],
    },
    [
      ...(extra ?? []),
      http.get('/api/v1/mail/attachments/21/content', () =>
        new HttpResponse(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { 'content-type': 'image/png' } }),
      ),
    ],
  )
  await openSource(view)
  return view
}

test('답장은 cid: 를 유지한 본문과 재첨부 대상(inlineImages)을 싣고, 맞는 첨부가 없는 cid 이미지는 뺀다', async () => {
  const send = sendHandler()
  const { user } = await openInlineMail([send.handler])
  await user.click(screen.getByTestId('mail-reply'))
  await user.click(await screen.findByTestId('mail-compose-quote-toggle'))
  await waitFor(() => expect(screen.getByTestId('mail-compose-quote-frame').getAttribute('srcdoc')).toMatch(/id="q-inline" src="data:image\/png;base64,/))
  expect(screen.getByTestId('mail-compose-quote-frame').getAttribute('srcdoc')).not.toContain('q-gone')
  await user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(send.calls).toHaveLength(1))
  const sent = send.last().body
  expect(sent.bodyHtml).toContain('src="cid:7dc8b642.png"')
  expect(sent.bodyHtml).not.toContain('data:image')
  expect(sent.bodyHtml).not.toContain('cid:none.png')
  expect(sent.inlineImages).toEqual([{ attachmentId: 21, contentId: '7dc8b642.png' }])
})

test('전달도 인라인 이미지를 재첨부 대상으로 싣는다', async () => {
  const send = sendHandler()
  const { user } = await openInlineMail([send.handler])
  await user.click(screen.getByTestId('mail-forward'))
  await user.click(await screen.findByTestId('mail-compose-to'))
  await user.paste('peer@test.local')
  await user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(send.calls).toHaveLength(1))
  expect(send.last().body.inlineImages).toEqual([{ attachmentId: 21, contentId: '7dc8b642.png' }])
})

test('인용문을 제거하면 재첨부 대상도 보내지 않는다', async () => {
  const send = sendHandler()
  const { user } = await openInlineMail([send.handler])
  await user.click(screen.getByTestId('mail-reply'))
  await user.click(await screen.findByTestId('mail-compose-quote-remove'))
  await typeBody(user, '인용 없이 회신')
  await user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(send.calls).toHaveLength(1))
  expect(send.last().body.inlineImages).toBeUndefined()
})

test('서버가 인라인 이미지 용량 초과(400)로 거부하면 그 문구를 보이고 도크를 유지한다', async () => {
  const msg = '인용문 이미지 용량이 너무 큽니다(최대 2MB). 인용문을 제거하고 보내세요'
  const send = sendHandler(() => HttpResponse.json({ status: 400, error: 'Bad Request', message: msg }, { status: 400 }))
  const { user } = await openInlineMail([send.handler])
  await user.click(screen.getByTestId('mail-reply'))
  await user.click(await screen.findByTestId('mail-compose-send'))
  expect(await screen.findByText(msg)).toBeInTheDocument()
  expect(screen.getByTestId('mail-compose-dock')).toBeInTheDocument()
})

// ── 초안 코칭(mail-coaching) ─────────────────────────────────────────────

const coachHandler = (reply: () => Response = () => HttpResponse.json({ notes: [{ dimension: 'TONE', message: '명령조가 강해요' }], improvedBodyHtml: '<p>다듬은 개선본입니다</p>' })) =>
  record<{ bodyHtml: string; bodyText: string }>('post', '/api/v1/mail/draft-coaching', reply)

async function openReplyForCoaching(coach = coachHandler()) {
  const view = renderMail('/mail/1', {
    accounts: [mailAccount({ aiEnabled: true })],
    handlers: [
      coach.handler,
      http.get('/api/v1/mail/accounts/1/messages', () => HttpResponse.json([summary({ id: 7, fromAddress: 'alice@example.com' })])),
      http.get('/api/v1/mail/messages/7', () => HttpResponse.json(detail({ id: 7, fromAddress: 'alice@example.com', bodyText: '원문' }))),
      http.get('/api/v1/mail/messages/7/summary', () => HttpResponse.json({ summary: '• 요약' })),
    ],
  })
  await view.user.click(await screen.findByTestId('mail-row-7'))
  await view.user.click(await screen.findByTestId('mail-reply'))
  await screen.findByTestId('mail-compose-dock')
  return { ...view, coach }
}

test('AI 검토 탭 → 노트·개선본(격리 프레임) → 개선본으로 교체하면 본문이 바뀌고 인용문은 남으며, 요청엔 인용문이 없다', async () => {
  const { user, coach } = await openReplyForCoaching()
  await typeBody(user, '자료 빨리 보내주세요')
  await user.click(screen.getByTestId('mail-review-tab'))
  expect(await screen.findByTestId('mail-coaching-note')).toHaveTextContent('명령조가 강해요')
  const improved = screen.getByTestId('mail-coaching-improved')
  await waitFor(() => expect(improved.getAttribute('srcdoc')).toContain('다듬은 개선본입니다'))
  expect(improved.getAttribute('srcdoc')).toContain(SANDBOX_HEAD)
  // #765 — 코칭 요청에 남의 원문(인용문)이 실리지 않는다. 백엔드는 bodyText 만 읽으므로 그 필드가 실제 관문이다.
  const req = coach.last().body
  expect(req.bodyHtml).toContain('자료 빨리 보내주세요')
  expect(req.bodyHtml).not.toContain('<blockquote>')
  expect(req.bodyHtml).not.toContain('님이 작성')
  expect(req.bodyText).toContain('자료 빨리 보내주세요')
  expect(req.bodyText).not.toContain('님이 작성')
  expect(req.bodyText).not.toContain('원문')
  await user.click(screen.getByTestId('mail-coaching-apply'))
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('다듬은 개선본입니다'))
  expect(screen.getByTestId('mail-compose-quote')).toBeInTheDocument()
})

test('AI 꺼짐(503) → 서버 문구를 검토 탭 안에 안내한다', async () => {
  const msg = '이 계정은 AI 비서가 꺼져 있어요. 계정 설정에서 켜주세요.'
  const { user } = await openReplyForCoaching(coachHandler(() => HttpResponse.json({ message: msg }, { status: 503 })))
  await typeBody(user, 'AI 꺼진 상태 테스트')
  await user.click(screen.getByTestId('mail-review-tab'))
  expect(await screen.findByTestId('mail-coaching-error')).toHaveTextContent(msg)
})
