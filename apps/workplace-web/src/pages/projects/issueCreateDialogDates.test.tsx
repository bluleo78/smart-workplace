// @vitest-environment jsdom
// happy-dom(화면 테스트 기본, WP-1002)과 날짜 칸·글자 수 제한·포커스 이동 처리가 달라 이 파일은 jsdom 에서 돈다.
// 새 이슈 다이얼로그 시작일·마감일 — 페이지 테스트(WP-971).
// 시작일 → POST payload, 시작 > 마감 차단, 5자리 연도 범위 안내(WP-900)는 브라우저 없이 판정되므로
// e2e/pages/projects/issue-start-date-milestone.spec.ts 에서 옮겼다. 날짜 칸 폭(WP-463, @layout)은 E2E 에 남는다.
// 화면 컴포넌트 테스트(WP-1002) — 목록 화면 대신 만들기 대화상자와 그것을 여는 「+ 새 이슈」만 띄운다(issueCreateDialogScreen).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { expectNoRequest, setBadInput } from '@/test/dateInput'
import { renderCreateDialog } from '@/test/kits/projects/issueCreateDialogScreen'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'

import { createIssue } from '../../../e2e/factories/issue.factory'

const KEY = 'WP'

/** 「+ 새 이슈」로 다이얼로그를 열고 제목을 채운다 — POST 본문은 posts 에 쌓는다. */
async function openCreate(title: string) {
  const posts: Record<string, unknown>[] = []
  const view = renderCreateDialog(KEY, [
    // 「AI 에게 맡기기」를 펼치면 담당 AI 후보를 받는다(「생성 후 실행」 경로 판정용, WP-1644).
    http.get(`/api/v1/projects/${KEY}/recurrence-agents`, () =>
      HttpResponse.json([{ id: 5, username: 'my-ai', name: '도우미', personalAssistant: true }]),
    ),
    http.post(`/api/v1/projects/${KEY}/issues`, async ({ request }) => {
      const p = (await request.json()) as Record<string, unknown>
      posts.push(p)
      return HttpResponse.json(createIssue({ startDate: (p.startDate as string) ?? null }), { status: 201 })
    }),
  ])
  await view.user.click(await screen.findByRole('button', { name: '+ 새 이슈' }, { timeout: SCREEN_LOAD_TIMEOUT }))
  const dialog = await screen.findByRole('dialog', { name: '새 이슈' })
  // 제목은 키 하나하나가 상관없어 붙여 넣는다(user.type 은 키당 약 25ms).
  await view.user.click(within(dialog).getByLabelText(/^제목/))
  await view.user.paste(title)
  const field = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!
  return { ...view, posts, dialog, field }
}

describe('새 이슈 다이얼로그 날짜 (#620)', () => {
  test('시작일을 넣고 생성하면 POST 에 startDate 가 실린다', async () => {
    const { user, posts, dialog, field } = await openCreate('타임라인 이슈')
    fireEvent.change(field('issue-start'), { target: { value: '2026-07-01' } })
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].startDate).toBe('2026-07-01')
  })

  test('시작일이 마감일보다 늦으면 오류를 보이고 생성 요청을 보내지 않는다', async () => {
    const { user, posts, dialog, field } = await openCreate('일정 역순 이슈')
    fireEvent.change(field('issue-start'), { target: { value: '2026-07-10' } })
    fireEvent.change(field('issue-due'), { target: { value: '2026-07-01' } })
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    expect(await screen.findByText('시작일은 마감일보다 늦을 수 없습니다')).toBeInTheDocument()
    expect(posts).toHaveLength(0)
    expect(screen.getByRole('dialog', { name: '새 이슈' })).toBeInTheDocument()
  })

  // WP-900: 5자리 연도(20260-10-23)는 두 칸 모두 한국어 범위 안내(영어 원문 아님)를 보이고 제출을 막는다.
  test('시작일·마감일 연도가 5자리면 두 칸에 한국어 범위 안내를 보이고 제출을 막는다', async () => {
    const { user, posts, dialog, field } = await openCreate('연도 오입력 이슈')
    for (const id of ['issue-start', 'issue-due']) fireEvent.change(field(id), { target: { value: '20260-10-23' } })
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    const msg = '날짜는 1900-01-01 ~ 9999-12-31 사이여야 합니다'
    await waitFor(() => expect(document.querySelector('#issue-start-error')).toHaveTextContent(msg))
    expect(document.querySelector('#issue-due-error')).toHaveTextContent(msg)
    expect(field('issue-due')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText(/Invalid string/)).not.toBeInTheDocument()
    expect(posts).toHaveLength(0)
  })
})

// WP-1644 — 시작일·마감일을 덜 넣은 채(예: '2026-07-' 까지만) 「생성」을 누르면 날짜 없는 이슈가 만들어졌다.
// <input type="date"> 는 덜 넣은 날짜를 값 '' 로 올려 「비움」과 같아 보이고 빈 칸에서 일부만 치면 change 도 오지 않으므로,
// 입력 요소의 validity.badInput 을 직접 읽어 막는다(공용 lib/dateInput). jsdom 은 덜 넣은 날짜를 칠 수 없어 validity 를 덮어 흉내 낸다.
describe('덜 넣은 날짜 (WP-1644)', () => {
  const MESSAGE = '날짜를 끝까지 입력하거나 칸을 비워 주세요.'



  test('시작일을 덜 넣고(change 없음) 생성하면 안내를 보이고 요청을 보내지 않는다', async () => {
    const { user, posts, dialog, field } = await openCreate('시작일 덜 넣음')
    setBadInput(field('issue-start'), true)
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(document.querySelector('#issue-start-error')).toHaveTextContent(MESSAGE))
    expect(field('issue-start')).toHaveAttribute('aria-invalid', 'true')
    expect(document.querySelector('#issue-due-error')).toBeNull()
    await expectNoRequest(posts)
    expect(screen.getByRole('dialog', { name: '새 이슈' })).toBeInTheDocument()
  })

  test('마감일을 덜 넣고 생성하면 마감일 칸에 안내를 보이고 요청을 보내지 않는다', async () => {
    const { user, posts, dialog, field } = await openCreate('마감일 덜 넣음')
    setBadInput(field('issue-due'), true)
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(document.querySelector('#issue-due-error')).toHaveTextContent(MESSAGE))
    expect(field('issue-due')).toHaveAttribute('aria-invalid', 'true')
    expect(document.querySelector('#issue-start-error')).toBeNull()
    await expectNoRequest(posts)
  })

  test('두 칸 모두 덜 넣으면 두 칸에 안내가 함께 선다', async () => {
    const { user, posts, dialog, field } = await openCreate('둘 다 덜 넣음')
    setBadInput(field('issue-start'), true)
    setBadInput(field('issue-due'), true)
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(document.querySelector('#issue-start-error')).toHaveTextContent(MESSAGE))
    expect(document.querySelector('#issue-due-error')).toHaveTextContent(MESSAGE)
    await expectNoRequest(posts)
  })

  test('「만들고 지금 실행」도 덜 넣은 날짜면 만들지 않는다', async () => {
    const { user, posts, dialog, field } = await openCreate('실행 경로')
    // AI 에게 맡기기를 켜면 주 버튼이 「만들고 지금 실행」(+ 「만들기만」)이 된다.
    await user.click(within(dialog).getByTestId('create-ai-handoff-toggle'))
    await within(dialog).findByTestId('create-ai-handoff-panel')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '만들고 지금 실행' })).toBeEnabled())
    setBadInput(field('issue-due'), true)
    await user.click(within(dialog).getByRole('button', { name: '만들고 지금 실행' }))
    await waitFor(() => expect(document.querySelector('#issue-due-error')).toHaveTextContent(MESSAGE))
    await expectNoRequest(posts)

    // 「만들기만」도 같다.
    await user.click(within(dialog).getByRole('button', { name: '만들기만' }))
    await expectNoRequest(posts)
    expect(document.querySelector('#issue-due-error')).toHaveTextContent(MESSAGE)
  })

  test('안내대로 덜 넣은 칸을 비우면(change 없음, keyUp) 안내가 사라지고 다시 제출하면 날짜 없이 만든다', async () => {
    const { user, posts, dialog, field } = await openCreate('비우고 다시')
    setBadInput(field('issue-start'), true)
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(document.querySelector('#issue-start-error')).toHaveTextContent(MESSAGE))

    setBadInput(field('issue-start'), false)
    fireEvent.keyUp(field('issue-start'), { key: 'Backspace' })
    await waitFor(() => expect(document.querySelector('#issue-start-error')).toBeNull())
    expect(field('issue-start')).not.toHaveAttribute('aria-invalid')

    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].startDate).toBeUndefined()
    expect(posts[0].dueDate).toBeUndefined()
  })

  // 리뷰 지적: 날짜만 먼저 알리고 끝내면 고친 뒤 다시 눌러서야 빈 제목 같은 다른 오류를 본다 — 한 번에 함께 보이고 첫 오류 칸(제목)으로 포커스.
  test('덜 넣은 날짜와 다른 오류(빈 제목)가 함께 있으면 두 안내를 한 번에 보이고 제목 칸으로 포커스를 옮긴다', async () => {
    const { user, posts, dialog, field } = await openCreate('제목 지울 이슈')
    await user.clear(within(dialog).getByLabelText(/^제목/))
    setBadInput(field('issue-due'), true)
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(document.querySelector('#issue-due-error')).toHaveTextContent(MESSAGE))
    expect(within(dialog).getByText('제목은 필수입니다')).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/^제목/)).toHaveFocus()
    await expectNoRequest(posts)

    // 제출을 한 번 한 뒤라 제목을 넣는 즉시 제목 안내가 걷힌다(날짜 안내는 그대로) — 다른 오류와 같은 검사 흐름.
    await user.paste('이제 제목 있음')
    await waitFor(() => expect(within(dialog).queryByText('제목은 필수입니다')).toBeNull())
    expect(document.querySelector('#issue-due-error')).toHaveTextContent(MESSAGE)
  })

  // 달력(날짜 고르기)으로 끝까지 채우면 keyUp·blur 없이 change 만 온다 — change 에서도 안내를 거둔다.
  test('안내가 선 뒤 달력으로 날짜를 고르면(change 만) 안내가 사라진다', async () => {
    const { user, dialog, field } = await openCreate('달력으로 고침')
    setBadInput(field('issue-start'), true)
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(document.querySelector('#issue-start-error')).toHaveTextContent(MESSAGE))

    setBadInput(field('issue-start'), false)
    fireEvent.change(field('issue-start'), { target: { value: '2026-07-01' } })
    await waitFor(() => expect(document.querySelector('#issue-start-error')).toBeNull())
    expect(field('issue-start')).not.toHaveAttribute('aria-invalid')
  })

  test('칸을 벗어날 때(blur)도 더는 덜 넣은 상태가 아니면 안내가 사라진다', async () => {
    const { user, dialog, field } = await openCreate('blur 로 거둠')
    setBadInput(field('issue-due'), true)
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(document.querySelector('#issue-due-error')).toHaveTextContent(MESSAGE))

    setBadInput(field('issue-due'), false)
    fireEvent.blur(field('issue-due'))
    await waitFor(() => expect(document.querySelector('#issue-due-error')).toBeNull())
  })

  test('여전히 덜 넣은 채 keyUp 하면 안내가 남는다', async () => {
    const { user, dialog, field } = await openCreate('아직 덜 넣음')
    setBadInput(field('issue-start'), true)
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(document.querySelector('#issue-start-error')).toHaveTextContent(MESSAGE))

    fireEvent.keyUp(field('issue-start'), { key: '1' })
    expect(document.querySelector('#issue-start-error')).toHaveTextContent(MESSAGE)
  })

  test('이미 고친 칸의 지난 안내는 다음 제출에서 거두고 새로 덜 넣은 칸에만 안내한다', async () => {
    const { user, posts, dialog, field } = await openCreate('칸 옮겨 덜 넣음')
    setBadInput(field('issue-start'), true)
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(document.querySelector('#issue-start-error')).toHaveTextContent(MESSAGE))

    // 시작일은 고쳤고(keyUp 없이) 마감일을 덜 넣은 채 다시 제출한다.
    setBadInput(field('issue-start'), false)
    setBadInput(field('issue-due'), true)
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(document.querySelector('#issue-due-error')).toHaveTextContent(MESSAGE))
    expect(document.querySelector('#issue-start-error')).toBeNull()
    await expectNoRequest(posts)
  })

  test('칸을 완전히 비우면(badInput 아님) 지금처럼 날짜 없이 만든다', async () => {
    const { user, posts, dialog, field } = await openCreate('완전히 비움')
    setBadInput(field('issue-start'), false)
    setBadInput(field('issue-due'), false)
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].startDate).toBeUndefined()
    expect(posts[0].dueDate).toBeUndefined()
    expect(document.querySelector('#issue-start-error')).toBeNull()
    expect(document.querySelector('#issue-due-error')).toBeNull()
  })

  test('기존 범위 오류(시작 > 마감)는 그대로 — 덜 넣음 안내로 바뀌지 않는다', async () => {
    const { user, posts, dialog, field } = await openCreate('범위 오류 유지')
    fireEvent.change(field('issue-start'), { target: { value: '2026-07-10' } })
    fireEvent.change(field('issue-due'), { target: { value: '2026-07-01' } })
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    expect(await screen.findByText('시작일은 마감일보다 늦을 수 없습니다')).toBeInTheDocument()
    expect(screen.queryByText(MESSAGE)).toBeNull()
    expect(posts).toHaveLength(0)
  })
})
