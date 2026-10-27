// @vitest-environment jsdom
// happy-dom(화면 테스트 기본, WP-1002)과 날짜 칸·글자 수 제한·포커스 이동 처리가 달라 이 파일은 jsdom 에서 돈다.
// 새 이슈 다이얼로그 시작일·마감일 — 페이지 테스트(WP-971).
// 시작일 → POST payload, 시작 > 마감 차단, 5자리 연도 범위 안내(WP-900)는 브라우저 없이 판정되므로
// e2e/pages/projects/issue-start-date-milestone.spec.ts 에서 옮겼다. 날짜 칸 폭(WP-463, @layout)은 E2E 에 남는다.
// 화면 컴포넌트 테스트(WP-1002) — 목록 화면 대신 만들기 대화상자와 그것을 여는 「+ 새 태스크」만 띄운다(issueCreateDialogScreen).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { renderCreateDialog } from '@/test/kits/projects/issueCreateDialogScreen'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'

import { createIssue } from '../../../e2e/factories/issue.factory'

const KEY = 'WP'

/** 「+ 새 태스크」로 다이얼로그를 열고 제목을 채운다 — POST 본문은 posts 에 쌓는다. */
async function openCreate(title: string) {
  const posts: Record<string, unknown>[] = []
  const view = renderCreateDialog(KEY, [
    http.post(`/api/v1/projects/${KEY}/issues`, async ({ request }) => {
      const p = (await request.json()) as Record<string, unknown>
      posts.push(p)
      return HttpResponse.json(createIssue({ startDate: (p.startDate as string) ?? null }), { status: 201 })
    }),
  ])
  await view.user.click(await screen.findByRole('button', { name: '+ 새 태스크' }, { timeout: SCREEN_LOAD_TIMEOUT }))
  const dialog = await screen.findByRole('dialog', { name: '새 이슈' })
  await view.user.type(within(dialog).getByLabelText(/^제목/), title)
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
