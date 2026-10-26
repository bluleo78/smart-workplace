// 모바일 메일 상세(WP-400) — 페이지 테스트(WP-981).
// AI 요약 접힘·펼침과 「AI 요약 보기」, 수신자 한 줄 요약·펼침, 조회 중·실패·다시 시도, ⋯ 메뉴 항목(안 읽음·AI 이슈·삭제)과 그 요청,
// 하단 바 버튼 구성(AI 사용 여부)과 답장·전체답장·전달·AI 답장이 채우는 작성 화면은 브라우저 없이 판정되므로
// e2e/pages/mobile/mail-detail-mobile.spec.ts 에서 옮겼다. 스크롤 제목 페이드·스크롤 초기화·하단 바·첨부 칩 기하·다크 원본 배경(@layout)은 E2E 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { chatHandlers } from '@/test/kits/mobile/chatHistory'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

import { detail, mailAccount, summary } from '../../../e2e/factories/mail.factory'

mockViewport()

const SUBJECT = '[공유] 4분기 통합 플랫폼 고도화 프로젝트 주간 진행 현황 및 다음 주 릴리스 일정 조율 요청'
const TO = '양동희 <me@example.com>, 이서연 <seoyeon.lee@example.com>, 박준호 <junho.park@example.com>'
const CC = [
  '최지우 <jiwoo.choi@example.com>',
  '정해인 <haein.jung@example.com>',
  '한소희 <sohee.han@example.com>',
  'devops-team@example.com',
  '오세훈 <sehoon.oh@example.com>',
  '윤아름 <areum.yoon@example.com>',
  'qa-lead@example.com',
].join(', ')
const SUMMARY = [
  '• 나에게: 김민수 팀장이 금요일까지 릴리스 체크리스트 검토를 요청했어요.',
  '• 핵심: 결제·알림 모듈 지연으로 1차 릴리스를 한 주 미루는 안을 논의해요.',
  '• 참고: 지난주 회의록과 첨부한 일정표를 함께 보면 좋아요.',
].join('\n')

type Opts = { aiEnabled?: boolean; detail10?: () => Response | Promise<Response>; summary11?: () => Record<string, unknown> | null }

/** 메일 화면 API — 10 = HTML 본문·요약 있음, 11 = 텍스트 본문·요약 생략(SKIPPED). 쓰기 요청은 posts 에 경로를 쌓는다. */
function mailApi(opts: Opts = {}) {
  const posts: string[] = []
  const handlers = [
    ...chatHandlers(),
    http.get('/api/v1/mail/accounts', () => HttpResponse.json([mailAccount({ aiEnabled: opts.aiEnabled ?? true })])),
    http.get('/api/v1/mail/unread-summary', () => HttpResponse.json({ workUnread: 1 })),
    http.get('/api/v1/mail/accounts/1/unread-counts', () =>
      HttpResponse.json({ classificationActive: true, inbox: 2, byCategory: { 업무: 2, 개인: 0, 알림: 0, 프로모션: 0, 뉴스레터: 0 }, needsReply: 0 }),
    ),
    // 목록은 안 읽음 요청 뒤에만 10 을 안 읽음으로 돌려준다(서버 반영 흉내).
    http.get('/api/v1/mail/accounts/1/messages', () =>
      HttpResponse.json([
        summary({ id: 10, seen: !posts.includes('/api/v1/mail/messages/10/unread'), subject: SUBJECT, fromName: '김민수', fromAddress: 'minsu.kim@example.com' }),
        summary({ id: 11, seen: true, subject: '자동 발송 알림', fromName: '알림봇', fromAddress: 'noreply@example.com' }),
      ]),
    ),
    http.get('/api/v1/mail/messages/10', () =>
      opts.detail10
        ? opts.detail10()
        : HttpResponse.json(detail({
          id: 10, seen: true, subject: SUBJECT, fromName: '김민수', fromAddress: 'minsu.kim@example.com',
          toAddresses: TO, ccAddresses: CC, bodyText: '본문입니다.', bodyHtml: null, attachments: [],
        })),
    ),
    http.get('/api/v1/mail/messages/11', () =>
      HttpResponse.json(detail({
        id: 11, seen: true, subject: '자동 발송 알림', fromName: '알림봇', fromAddress: 'noreply@example.com',
        toAddresses: 'me@example.com', ccAddresses: null, bodyText: '본문 1번째 줄입니다.', bodyHtml: null, attachments: [],
      })),
    ),
    http.get('/api/v1/mail/messages/10/summary', () => HttpResponse.json({ summary: SUMMARY, status: 'DONE' })),
    http.get('/api/v1/mail/messages/11/summary', () => HttpResponse.json(opts.summary11?.() ?? { summary: null, status: 'SKIPPED' })),
    // 작성 화면의 받는사람 자동완성 후보.
    http.get('/api/v1/mail/recent-recipients', () => HttpResponse.json([])),
    http.get('/api/v1/mail/messages/:id/linked-issue', () => HttpResponse.json({ issueKey: null })),
    http.post('/api/v1/mail/messages/:id/:action', ({ request }) => {
      const path = new URL(request.url).pathname
      posts.push(path)
      if (path.endsWith('/issue-draft'))
        return HttpResponse.json({ title: '릴리스 체크리스트 검토', body: '- 금요일까지 회신', priority: 'HIGH', suggestedProjectKey: 'FIN', candidateProjects: [{ key: 'FIN', name: '재무' }] })
      if (path.endsWith('/reply-draft')) return HttpResponse.json({ draftBody: 'AI가 쓴 회신 초안' })
      // 요약 생성은 만든 요약을 그대로 돌려준다(이후 조회도 같은 값).
      if (path.endsWith('/11/summary')) return HttpResponse.json(opts.summary11?.() as Record<string, unknown>)
      return new HttpResponse(null, { status: 204 })
    }),
  ]
  return { handlers, posts }
}

/** /mail/1 을 열고 목록에서 메일을 연다. */
async function openMail(id: number, opts: Opts = {}) {
  const api = mailApi(opts)
  // 상세 ‹·안 읽음은 히스토리로 닫는다 — 실제 세션 히스토리(BrowserRouter)로 띄운다.
  const page = renderPage('/mail/1', { handlers: api.handlers })
  await page.user.click(await screen.findByTestId(`mail-row-${id}`, {}, { timeout: PAGE_LOAD_TIMEOUT }))
  return { ...page, api }
}

/** 상세 헤더 ‹ 로 목록에 돌아가 다른 메일을 연다. */
async function reopen(user: ReturnType<typeof renderPage>['user'], id: number) {
  await user.click(within(screen.getByTestId('mail-back')).getByTestId('mobile-back'))
  // ‹ 는 history.back — popstate 가 와서 상세가 닫힌 뒤에 목록을 누른다(목록은 상세 뒤에 늘 그려져 있다).
  await waitFor(() => expect(screen.queryByTestId('mail-back')).not.toBeInTheDocument())
  await user.click(await screen.findByTestId(`mail-row-${id}`))
  await screen.findByTestId('mail-detail')
}

const summaryCard = () => screen.getByTestId('mail-ai-summary') as HTMLDetailsElement

describe('AI 요약', () => {
  test('첫 줄 미리보기로 접혀 있고, 탭하면 펼치고 다시 탭하면 접는다', async () => {
    const { user } = await openMail(10)
    const card = (await screen.findByTestId('mail-ai-summary')) as HTMLDetailsElement
    expect(card.open).toBe(false)
    // 접힌 동안엔 첫 불릿(기호 뗌)만 한 줄로 — 나머지 불릿은 보이지 않는다.
    const head = card.querySelector('summary')!
    expect(head).toHaveTextContent('나에게: 김민수 팀장이')
    expect(within(card).getByText(/핵심: 결제/)).not.toBeVisible()
    await user.click(head)
    expect(summaryCard().open).toBe(true)
    expect(within(card).getByText(/핵심: 결제/)).toBeVisible()
    await user.click(head)
    expect(summaryCard().open).toBe(false)
  })

  test('「AI 요약 보기」로 만든 요약은 펼친 채 보이고, 다른 메일을 갔다 오면 접혀 있다', async () => {
    // 생성 전엔 SKIPPED, 생성(POST) 뒤 조회는 만든 요약을 돌려준다(서버 저장 흉내).
    let generated = false
    const { user, api } = await openMail(11, {
      summary11: () => (generated ? { summary: '• 핵심: 서버 점검 안내 자동 메일이에요.\n• 참고: 조치할 일은 없어요.', status: 'DONE' } : null),
    })
    const button = await screen.findByTestId('mail-ai-summary-generate')
    expect(button).toHaveTextContent('AI 요약 보기')
    generated = true
    await user.click(button)
    await waitFor(() => expect(api.posts).toContain('/api/v1/mail/messages/11/summary'))
    await waitFor(() => expect(summaryCard().open).toBe(true))
    expect(within(summaryCard()).getByText(/조치할 일은 없어요/)).toBeVisible()

    // 다른 메일을 열었다가 돌아오면 다른 요약과 같이 접힌 채.
    await reopen(user, 10)
    await reopen(user, 11)
    await waitFor(() => expect(summaryCard().querySelector('summary')).toHaveTextContent('핵심: 서버 점검 안내'))
    expect(summaryCard().open).toBe(false)
  })
})

test('수신자는 「받는사람 첫 사람 외 N명 · 참조 N명」 한 줄이고, 탭하면 전체 목록을 펼치고 다시 탭하면 접는다', async () => {
  const { user } = await openMail(10)
  const toggle = await screen.findByTestId('mail-recipients-toggle')
  expect(toggle).toHaveTextContent('받는사람 양동희 외 2명 · 참조 7명')
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByTestId('mail-recipients-full')).not.toBeInTheDocument()

  await user.click(toggle)
  const full = screen.getByTestId('mail-recipients-full')
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(within(full).getByText('이서연 <seoyeon.lee@example.com>')).toBeInTheDocument()
  expect(within(full).getByText('최지우 <jiwoo.choi@example.com>')).toBeInTheDocument()
  // 이름 없는 주소는 주소 그대로.
  expect(within(full).getByText('qa-lead@example.com', { exact: true })).toBeInTheDocument()
  expect(within(full).getAllByRole('listitem')).toHaveLength(10)

  await user.click(toggle)
  expect(screen.queryByTestId('mail-recipients-full')).not.toBeInTheDocument()
})

describe('조회 중·실패 화면', () => {
  test('응답을 기다리는 동안에도 상단바(‹)가 있고, 응답이 오면 상세가 그려진다', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    await openMail(10, {
      detail10: async () => {
        await held
        return HttpResponse.json(detail({ id: 10, seen: true, subject: SUBJECT, toAddresses: TO, ccAddresses: CC, attachments: [] }))
      },
    })
    expect(await screen.findByText('불러오는 중…')).toBeInTheDocument()
    expect(within(screen.getByTestId('mail-back')).getByTestId('mobile-back')).toBeInTheDocument()
    release()
    expect(await screen.findByRole('heading', { level: 2, name: SUBJECT })).toBeInTheDocument()
  })

  test('조회 실패(500) 화면에도 ‹ 가 있어 목록으로 돌아가고, 「다시 시도」가 성공하면 상세로 바뀐다', async () => {
    let failing = true
    const { user } = await openMail(10, {
      detail10: () =>
        failing
          ? HttpResponse.json({ message: 'boom' }, { status: 500 })
          : HttpResponse.json(detail({ id: 10, seen: true, subject: SUBJECT, toAddresses: TO, ccAddresses: CC, attachments: [] })),
    })
    expect(await screen.findByText('메일을 불러오지 못했습니다')).toBeInTheDocument()
    await user.click(within(screen.getByTestId('mail-back')).getByTestId('mobile-back'))
    await waitFor(() => expect(screen.queryByText('메일을 불러오지 못했습니다')).not.toBeInTheDocument())
    expect(screen.getByTestId('mail-list')).toBeInTheDocument()

    await user.click(screen.getByTestId('mail-row-10'))
    expect(await screen.findByText('메일을 불러오지 못했습니다')).toBeInTheDocument()
    failing = false
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('heading', { level: 2, name: SUBJECT })).toBeInTheDocument()
    expect(screen.getByTestId('mail-mobile-action-bar')).toBeInTheDocument()
  })
})

describe('⋯ 메뉴', () => {
  test('AI 사용 계정: 「안 읽음」은 ⋯ 메뉴 안에 있고, 누르면 안 읽음 API 후 목록으로 돌아가 안 읽음 표시가 붙는다', async () => {
    const { user, api } = await openMail(10)
    const bar = await screen.findByTestId('mail-back')
    expect(screen.queryByTestId('mail-unread-bar-10')).not.toBeInTheDocument()
    // 헤더에 글자 버튼으로 나와 있지 않다 — 메뉴를 열어야 한다.
    expect(within(bar).queryByTestId('mobile-header-inline-action')).not.toBeInTheDocument()
    await user.click(within(bar).getByTestId('mobile-header-more'))
    const menu = within(bar).getByTestId('mobile-header-more-menu')
    // 라이트 테마라 원본 배경 토글은 없다 — 안 읽음, AI로 이슈 만들기, 삭제(WP-962, 맨 아래). 보관 메일함이 없어 보관·옮기기는 없다.
    expect(within(menu).getAllByRole('menuitem').map((el) => el.textContent?.trim())).toEqual(['안 읽음', 'AI로 이슈 만들기', '삭제'])
    await user.click(within(menu).getByTestId('mobile-mark-unread'))
    await waitFor(() => expect(api.posts).toContain('/api/v1/mail/messages/10/unread'))
    await waitFor(() => expect(screen.queryByTestId('mail-detail')).not.toBeInTheDocument())
    expect(screen.getByTestId('mail-list')).toBeInTheDocument()
    expect(await screen.findByTestId('mail-unread-bar-10')).toBeInTheDocument()
  })

  test('「AI로 이슈 만들기」 → 이슈 초안 API 후 사전채움된 이슈 만들기 창', async () => {
    const { user, api } = await openMail(10)
    const bar = await screen.findByTestId('mail-back')
    await user.click(within(bar).getByTestId('mobile-header-more'))
    await user.click(within(bar).getByTestId('mail-ai-issue'))
    await waitFor(() => expect(api.posts).toContain('/api/v1/mail/messages/10/issue-draft'))
    await screen.findByTestId('mail-to-issue-dialog')
    expect(await screen.findByTestId('issue-draft-title')).toHaveValue('릴리스 체크리스트 검토')
  })
})

describe('하단 고정 바', () => {
  /** 수신인 칸 칩 값(`이름 <주소>` 또는 주소) — 입력 칸 값 대신 칩을 본다(WP-945). */
  const chips = (field: 'to' | 'cc') => screen.queryAllByTestId(`mail-compose-${field}-chip`).map((el) => el.getAttribute('data-value'))

  test('답장·전체답장·전달·AI 답장이 각각 알맞게 채운 작성 화면을 연다', async () => {
    const { user, api } = await openMail(10)
    const actions = await screen.findByTestId('mail-mobile-action-bar')
    const close = async () => {
      await user.click(screen.getByTestId('mail-compose-close'))
      await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
    }

    // 답장 — 보낸 사람에게, Re: 제목, 인용문.
    await user.click(within(actions).getByTestId('mail-reply'))
    const dock = await screen.findByTestId('mail-compose-dock')
    expect(within(dock).getByRole('heading', { name: '회신' })).toBeInTheDocument()
    await waitFor(() => expect(chips('to')).toEqual(['minsu.kim@example.com']))
    expect(screen.getByTestId('mail-compose-subject')).toHaveValue(`Re: ${SUBJECT}`)
    expect(within(dock).getByTestId('mail-compose-quote')).toBeInTheDocument()
    await close()

    // 전체답장 — 받는사람·참조 중 나를 뺀 나머지가 참조로.
    await user.click(within(actions).getByTestId('mail-reply-all'))
    await waitFor(() => expect(chips('to')).toEqual(['minsu.kim@example.com']))
    await waitFor(() => expect(chips('cc').join(', ')).toMatch(/seoyeon\.lee@example\.com/))
    expect(chips('cc').join(', ')).toMatch(/qa-lead@example\.com/)
    expect(chips('cc').join(', ')).not.toMatch(/me@example\.com/)
    await close()

    // 전달 — 받는사람 빈 칸, Fwd: 제목.
    await user.click(within(actions).getByTestId('mail-forward'))
    expect(within(await screen.findByTestId('mail-compose-dock')).getByRole('heading', { name: '전달' })).toBeInTheDocument()
    expect(screen.getByTestId('mail-compose-to')).toHaveValue('')
    expect(chips('to')).toEqual([])
    expect(screen.getByTestId('mail-compose-subject')).toHaveValue(`Fwd: ${SUBJECT}`)
    await close()

    // AI 답장 — 초안 API 결과가 본문에 채워진 회신.
    expect(within(actions).getByTestId('mail-ai-reply-draft')).toHaveTextContent('AI 답장')
    await user.click(within(actions).getByTestId('mail-ai-reply-draft'))
    await waitFor(() => expect(api.posts).toContain('/api/v1/mail/messages/10/reply-draft'))
    await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('AI가 쓴 회신 초안'))
    expect(chips('to')).toEqual(['minsu.kim@example.com'])
  })

  // WP-962 부터 받은편지함 메일은 「삭제」도 메뉴에 있어 항목이 둘 — ⋯ 메뉴로 묶인다(항목 하나일 때만 헤더에 바로 둔다, U3-R7).
  test('AI 미사용 계정: 하단 바는 3버튼(AI 답장 없음), ⋯ 메뉴는 안 읽음·삭제', async () => {
    const { user } = await openMail(11, { aiEnabled: false })
    const actions = await screen.findByTestId('mail-mobile-action-bar')
    expect(within(actions).getAllByRole('button').map((el) => el.textContent?.trim())).toEqual(['답장', '전체답장', '전달'])
    const bar = screen.getByTestId('mail-back')
    expect(within(bar).queryByTestId('mobile-header-inline-action')).not.toBeInTheDocument()
    await user.click(within(bar).getByTestId('mobile-header-more'))
    expect(within(within(bar).getByTestId('mobile-header-more-menu')).getAllByRole('menuitem').map((el) => el.textContent?.trim())).toEqual(['안 읽음', '삭제'])
  })
})
