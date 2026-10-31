// 이슈 코멘트 목록·작성창(#154·#310·#320·#344·#620·#785·WP-254·WP-885) — 페이지 테스트(WP-980).
// 작성칸 렌더·길이 상한 안내와 전송 막힘·수정/삭제 payload·작성자별 버튼 노출·날짜 포맷·본문 클래스·
// 새로고침 경고(beforeunload)·AGENT 마크다운 렌더는 브라우저 없이 판정되므로 e2e/pages/projects/issue-comments.spec.ts 에서 옮겼다.
// RichInput(TipTap) 의 키 입력은 jsdom 이 브라우저처럼 처리하지 못해 편집기 명령(setRichText)으로 값을 채운다 —
// 실제 타이핑·@ 자동완성·자동 포커스 위치·키보드 삭제 뒤 포커스 이동은 E2E(@input)가, 작성 → POST → 목록 갱신 배선은 E2E(@wiring)가 지킨다.
// 화면 테스트(WP-1002) — 이슈 상세 화면만 renderIssueDetailScreen 으로 띄운다(App·인증 부팅·앱 셸 없이). 속성 레일·본문·활동이 상세 재조회로 이어져 화면 단위로 둔다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { DETAIL_PATH, type DetailRef, detailRefOf, ISSUE_ID, ME_ID, setRichText } from '@/test/kits/projects/issueDetailRef'
import { renderIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { issueDetailHandlers } from '@/test/kits/projects/issueDetailStubs'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import type { IssueCommentResponse } from '@/types/issue'

import { createAgentComment, createComment } from '../../../e2e/factories/issue.factory'
import { createAgentMember, createMember } from '../../../e2e/factories/project.factory'
import { LINKED_COMMENT_HIGHLIGHT_MS } from './components/IssueCommentList'

const COMMENTS = `/api/v1/issues/${ISSUE_ID}/comments`

type Call = { method: string; path: string; body: unknown }

/** 코멘트 쓰기 API — 작성·수정·삭제를 detailRef 에 서버처럼 반영하고 요청을 calls 에 쌓는다. */
function commentWrites(ref: DetailRef, calls: Call[]) {
  return [
    http.post(COMMENTS, async ({ request }) => {
      const { body } = (await request.json()) as { body: string }
      calls.push({ method: 'POST', path: COMMENTS, body: { body } })
      const created = createComment({ id: 90, issueId: ISSUE_ID, authorId: ME_ID, body })
      ref.current = { ...ref.current, comments: [...ref.current.comments, created] }
      return HttpResponse.json(created, { status: 201 })
    }),
    http.patch(`${COMMENTS}/:id`, async ({ request, params }) => {
      const { body } = (await request.json()) as { body: string }
      calls.push({ method: 'PATCH', path: new URL(request.url).pathname, body: { body } })
      ref.current = { ...ref.current, comments: ref.current.comments.map((c) => (c.id === Number(params.id) ? { ...c, body } : c)) }
      return HttpResponse.json(ref.current.comments.find((c) => c.id === Number(params.id)))
    }),
    http.delete(`${COMMENTS}/:id`, ({ request, params }) => {
      calls.push({ method: 'DELETE', path: new URL(request.url).pathname, body: null })
      ref.current = { ...ref.current, comments: ref.current.comments.filter((c) => c.id !== Number(params.id)) }
      return new HttpResponse(null, { status: 204 })
    }),
  ]
}

/** 코멘트 목록으로 이슈 상세를 연다. ready 는 첫 화면이 떴다고 볼 요소(기본: 작성칸). */
async function open(comments: IssueCommentResponse[] = [], members = [] as ReturnType<typeof createMember>[], path = DETAIL_PATH) {
  const ref = detailRefOf({ comments })
  const calls: Call[] = []
  const view = renderIssueDetailScreen(path, { handlers: [...issueDetailHandlers({ detail: () => ref.current, members }), ...commentWrites(ref, calls)] })
  const input = await screen.findByTestId('issue-comment-input', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  return { ...view, ref, calls, input }
}

/** 코멘트 섹션의 li 목록. */
const commentItems = () => within(screen.getByRole('region', { name: '코멘트' })).queryAllByRole('listitem')

/** beforeunload 를 흉내 내 보내고 기본 동작이 막혔는지(= 경고가 뜨는지) 돌려준다. */
function beforeUnloadPrevented() {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

describe('코멘트 작성칸 (#310·#785·WP-885)', () => {
  test('작성칸은 textarea 가 아닌 RichInput 이고 스크린리더 이름은 「코멘트 작성」이다(WP-831)', async () => {
    const { input } = await open()
    expect(input).toHaveAttribute('contenteditable', 'true')
    expect(document.querySelector('textarea[placeholder="코멘트를 작성하세요"]')).toBeNull()
    expect(input).toHaveAccessibleName('코멘트 작성')
  })

  test('5만 1자는 자르지 않고 글자 수 안내 + 버튼·Enter 전송이 막히고, 5만자로 줄이면 그대로 전송된다', async () => {
    const { user, input, calls } = await open()
    setRichText(input, '가'.repeat(50001))
    expect(await screen.findByTestId('issue-comment-input-limit-error')).toHaveTextContent('코멘트는 50000자 이하여야 합니다 (현재 50001자)')
    expect(screen.getByTestId('issue-comment-submit')).toBeDisabled()
    // 키보드 전송(Enter)도 막힌다 — 요청이 없고 안내는 남는다.
    fireEvent.keyDown(input, { key: 'Enter' })
    await new Promise((r) => setTimeout(r, 100))
    expect(calls).toEqual([])
    expect(screen.getByTestId('issue-comment-input-limit-error')).toBeInTheDocument()

    setRichText(input, '가'.repeat(50000))
    await waitFor(() => expect(screen.queryByTestId('issue-comment-input-limit-error')).not.toBeInTheDocument())
    expect(screen.getByTestId('issue-comment-submit')).toBeEnabled()
    await user.click(screen.getByTestId('issue-comment-submit'))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect((calls[0].body as { body: string }).body).toHaveLength(50000)
  })
})

describe('코멘트 수정·삭제 (#154)', () => {
  test('내 코멘트 — 수정 → 인라인 편집칸(「코멘트 수정」)에 원문 → 저장하면 PATCH 본문이 바뀌고 목록이 갱신된다', async () => {
    const { user, calls } = await open([createComment({ id: 10, issueId: ISSUE_ID, authorId: ME_ID, body: '원본 코멘트' })])
    await user.click(await screen.findByRole('button', { name: '코멘트 수정' }))
    const edit = await screen.findByTestId('issue-comment-edit-input')
    expect(edit).toHaveTextContent('원본 코멘트')
    expect(edit).toHaveAccessibleName('코멘트 수정')
    setRichText(edit, '수정된 코멘트')
    await user.click(screen.getByTestId('issue-comment-edit-save'))
    await waitFor(() => expect(calls).toEqual([{ method: 'PATCH', path: `${COMMENTS}/10`, body: { body: '수정된 코멘트' } }]))
    await waitFor(() => expect(screen.queryByTestId('issue-comment-edit-input')).not.toBeInTheDocument())
    expect(commentItems()[0]).toHaveTextContent('수정된 코멘트')
  })

  test('수정칸 — 5만 1자는 안내 + 저장 버튼·Enter 가 막히고(PATCH 없음) 편집칸이 그대로 남는다', async () => {
    const { user, calls } = await open([createComment({ id: 10, issueId: ISSUE_ID, authorId: ME_ID, body: '원본 코멘트' })])
    await user.click(await screen.findByRole('button', { name: '코멘트 수정' }))
    const edit = await screen.findByTestId('issue-comment-edit-input')
    setRichText(edit, '나'.repeat(50001))
    expect(await screen.findByTestId('issue-comment-edit-input-limit-error')).toHaveTextContent('코멘트는 50000자 이하여야 합니다 (현재 50001자)')
    expect(screen.getByTestId('issue-comment-edit-save')).toBeDisabled()
    fireEvent.keyDown(edit, { key: 'Enter' })
    await new Promise((r) => setTimeout(r, 100))
    expect(calls).toEqual([])
    expect(screen.getByTestId('issue-comment-edit-input')).toBeInTheDocument()
  })

  test('내 코멘트 — 삭제 → 확인창 「삭제」 → DELETE 하고 마지막 코멘트였으면 빈 안내가 보인다', async () => {
    const { user, calls } = await open([createComment({ id: 11, issueId: ISSUE_ID, authorId: ME_ID, body: '삭제할 코멘트' })])
    await user.click(await screen.findByRole('button', { name: '코멘트 삭제' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(calls).toEqual([{ method: 'DELETE', path: `${COMMENTS}/11`, body: null }]))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(await screen.findByText('코멘트가 없습니다')).toBeInTheDocument()
  })

  test('남의 코멘트·AGENT 코멘트에는 수정·삭제 버튼이 없다', async () => {
    await open([
      createComment({ id: 12, issueId: ISSUE_ID, authorId: ME_ID + 999, authorName: '다른 사용자', body: '타인의 코멘트' }),
      createAgentComment({ id: 13, issueId: ISSUE_ID }),
    ])
    await screen.findByText('타인의 코멘트')
    expect(screen.getByText('확인 후 처리하겠습니다')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '코멘트 수정' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '코멘트 삭제' })).not.toBeInTheDocument()
  })
})

describe('코멘트 링크 (WP-1175)', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const others = () => [
    createComment({ id: 12, issueId: ISSUE_ID, authorId: ME_ID + 999, authorName: '다른 사용자', body: '타인의 코멘트' }),
    createAgentComment({ id: 13, issueId: ISSUE_ID }),
  ]

  test('남의 코멘트에도 링크 복사가 있고, 누르면 그 코멘트로 가는 주소가 복사된다', async () => {
    const { user } = await open(others())
    await screen.findByText('타인의 코멘트')
    expect(screen.getByTestId('issue-comment-copy-link-13')).toBeInTheDocument()
    await user.click(screen.getByTestId('issue-comment-copy-link-12'))
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}${DETAIL_PATH}#comment-12`))
    expect(await screen.findByText('코멘트 링크를 복사했습니다')).toBeInTheDocument()
  })

  test('코멘트 「채팅·이슈로 보내기」는 그 코멘트 주소로 대화상자를 열고, 복사 토스트에도 같은 보내기가 있다(WP-1236)', async () => {
    const { closeSendToChat, sendToChatTarget } = await import('@/lib/sendToChat')
    const { user } = await open(others())
    await screen.findByText('타인의 코멘트')
    const url = `${window.location.origin}${DETAIL_PATH}#comment-12`
    await user.click(screen.getByTestId('issue-comment-send-12'))
    await waitFor(() => expect(sendToChatTarget()).toMatchObject({ kind: 'issue', url }))
    act(() => closeSendToChat())
    await user.click(screen.getByTestId('issue-comment-copy-link-12'))
    await user.click(await screen.findByRole('button', { name: '채팅으로 보내기' }))
    await waitFor(() => expect(sendToChatTarget()).toMatchObject({ kind: 'issue', url }))
    act(() => closeSendToChat())
  })

  test('#comment-<id> 로 열면 그 코멘트로 스크롤해 잠시 강조하고, 시간이 지나면 강조를 거둔다', async () => {
    const scrolled: Element[] = []
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolled.push(this)
    })
    await open(others(), [], `${DETAIL_PATH}#comment-13`)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const row = (await screen.findByText('확인 후 처리하겠습니다')).closest('li')!
    await waitFor(() => expect(row).toHaveAttribute('data-highlighted', 'true'))
    expect(row).toHaveAttribute('id', 'comment-13')
    expect(scrolled).toContain(row)
    expect(screen.getByText('타인의 코멘트').closest('li')).not.toHaveAttribute('data-highlighted')
    act(() => vi.advanceTimersByTime(LINKED_COMMENT_HIGHLIGHT_MS))
    await waitFor(() => expect(row).not.toHaveAttribute('data-highlighted'))
  })

  test('이력 탭을 보던 중 같은 이슈의 코멘트 링크로 가면 코멘트 탭으로 돌아와 그 코멘트를 강조한다', async () => {
    const { user } = await open(others())
    await user.click(screen.getByRole('tab', { name: '이력' }))
    expect(screen.getByRole('tab', { name: '이력' })).toHaveAttribute('aria-selected', 'true')
    act(() => {
      window.history.pushState(null, '', `${DETAIL_PATH}#comment-12`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await waitFor(() => expect(screen.getByRole('tab', { name: '코멘트' })).toHaveAttribute('aria-selected', 'true'))
    await waitFor(() => expect(screen.getByText('타인의 코멘트').closest('li')).toHaveAttribute('data-highlighted', 'true'))
  })

  test('링크로 연 뒤 해시만 다른 코멘트 링크로 바꿔도 그 링크를 다시 처리한다(첫 진입·해시 이동은 key 가 같다)', async () => {
    await open(others(), [], `${DETAIL_PATH}#comment-13`)
    await waitFor(() => expect(screen.getByText('확인 후 처리하겠습니다').closest('li')).toHaveAttribute('data-highlighted', 'true'))
    act(() => {
      window.history.pushState(null, '', `${DETAIL_PATH}#comment-999`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(await screen.findByText('링크한 코멘트를 찾을 수 없습니다 — 삭제됐을 수 있습니다')).toBeInTheDocument()
  })

  test('링크로 연 뒤 해시를 그대로 둔 이동(채팅 드로워·미리보기 열고 닫기)에는 다시 스크롤·강조하지 않는다', async () => {
    const scrolled: Element[] = []
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolled.push(this)
    })
    await open(others(), [], `${DETAIL_PATH}#comment-13`)
    const row = (await screen.findByText('확인 후 처리하겠습니다')).closest('li')!
    await waitFor(() => expect(row).toHaveAttribute('data-highlighted', 'true'))
    const before = scrolled.length
    // useHistoryParam 처럼 질의만 바꾸고 해시는 그대로 둔 채 열고(push) 닫는다(back 대신 새 이동).
    for (const url of [`${DETAIL_PATH}?chat=1#comment-13`, `${DETAIL_PATH}#comment-13`]) {
      act(() => {
        window.history.pushState(null, '', url)
        window.dispatchEvent(new PopStateEvent('popstate'))
      })
      await act(async () => {})
    }
    expect(scrolled.length).toBe(before)
  })

  test('지워진 코멘트의 링크로 열면 찾을 수 없다고 알리고 이슈는 그대로 보인다', async () => {
    await open(others(), [], `${DETAIL_PATH}#comment-999`)
    expect(await screen.findByText('링크한 코멘트를 찾을 수 없습니다 — 삭제됐을 수 있습니다')).toBeInTheDocument()
    expect(screen.getByText('타인의 코멘트').closest('li')).not.toHaveAttribute('data-highlighted')
  })
})

describe('코멘트 표시 (#320·#344)', () => {
  test('날짜는 초 없이 분 단위(YYYY-MM-DD HH:mm), 본문은 body-secondary(text-sm·leading-6·text-foreground)', async () => {
    await open([createComment({ id: 30, issueId: ISSUE_ID, authorId: ME_ID, body: '날짜 포맷 테스트 코멘트', createdAt: '2026-06-08T03:06:36Z' })])
    const body = await screen.findByText('날짜 포맷 테스트 코멘트')
    const item = commentItems()[0]
    expect(item.textContent).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
    expect(item.textContent).not.toMatch(/\d{1,2}:\d{2}:\d{2}/)
    const bodyDiv = within(item).getByTestId('markdown-content')
    expect(bodyDiv).toContainElement(body)
    expect(bodyDiv).toHaveClass('text-sm', 'leading-6', 'text-foreground')
  })
})

describe('새로고침 유실 경고 (#620)', () => {
  test('비어 있으면 경고가 없고, 쓰는 중이면 경고, 제출이 끝나면 경고가 풀린다', async () => {
    const { user, input } = await open()
    await screen.findByText('코멘트가 없습니다')
    expect(beforeUnloadPrevented()).toBe(false)

    setRichText(input, '제출된 코멘트')
    await waitFor(() => expect(beforeUnloadPrevented()).toBe(true))

    await user.click(screen.getByTestId('issue-comment-submit'))
    // 입력창이 비면 제출이 끝난 것 — 그 뒤 effect 에서 리스너가 풀린다.
    await waitFor(() => expect(screen.getByTestId('issue-comment-input')).not.toHaveTextContent('제출된 코멘트'))
    expect(await within(screen.getByRole('region', { name: '코멘트' })).findByText('제출된 코멘트')).toBeInTheDocument()
    await waitFor(() => expect(beforeUnloadPrevented()).toBe(false))
  })
})

describe('AGENT 코멘트 마크다운 렌더 (WP-254)', () => {
  const AGENT_BODY = [
    '## 조사 결과',
    '',
    '**원인**: 정산 배치가 재시도 시 멱등 키 없이 다시 적재했습니다. 담당 <@1> 확인 부탁드립니다.',
    '',
    '- [x] 로그 수집',
    '- [ ] 재현 테스트 작성',
    '- [ ] 수정 배포',
    '',
    '<b>raw</b>',
  ].join('\n')

  test('AGENT 코멘트는 마크다운 — 제목·굵게, 불릿 없는 읽기 전용 체크리스트, 멘션은 @이름, 원시 HTML 은 해석하지 않는다', async () => {
    await open(
      [createAgentComment({ id: 30, issueId: ISSUE_ID, body: AGENT_BODY })],
      [createMember({ userId: 1, name: 'Tester' }), createAgentMember()],
    )
    // 이슈 본문도 markdown-content 라 AGENT 코멘트 카드(li[data-agent]) 안에서 찾는다.
    await screen.findByText('조사 결과')
    const agentItem = commentItems().find((li) => li.getAttribute('data-agent') === 'true')!
    const md = within(agentItem).getByTestId('markdown-content')
    expect(within(md).getByRole('heading', { name: '조사 결과' })).toBeInTheDocument()
    expect(md.querySelector('strong')).toHaveTextContent('원인')
    expect(md).not.toHaveTextContent('##')
    expect(md).not.toHaveTextContent('**')

    const boxes = within(md).getAllByRole('checkbox')
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, false, false])
    for (const b of boxes) expect(b).toBeDisabled()
    // 체크리스트 ul 은 불릿 없음(list-none).
    expect(md.querySelector('ul')).toHaveClass('list-none')

    await waitFor(() => expect(md).toHaveTextContent('담당 @Tester 확인'))
    expect(md).not.toHaveTextContent('<@1>')
    expect(md.querySelector('b')).toBeNull()
  })

  test('사람 코멘트도 마크다운으로 — 굵게·체크리스트가 서식대로 보인다 (WP-1015)', async () => {
    await open([createComment({ id: 31, issueId: ISSUE_ID, authorId: 2, authorName: '김개발', body: '**굵게**\n\n- [ ] 체크' })])
    await screen.findByText('굵게')
    const item = commentItems()[0]
    expect(within(item).getByTestId('markdown-content').querySelector('strong')).toHaveTextContent('굵게')
    expect(item).not.toHaveTextContent('**')
    expect(within(item).getAllByRole('checkbox')).toHaveLength(1)
  })
})
