// 이슈 상세 AI 현황 카드(Instant Context, #517 온디맨드) — 페이지 테스트(WP-980).
// 카드 문구·블로커 배지·접기·생성 POST → 재조회 → 요약 반영·aiAvailable 게이트는 브라우저 없이 판정되므로
// e2e/pages/projects/issue-instant-context.spec.ts 에서 옮겼다. 블로커 배지 글자 대비(WP-303, 계산된 색)는 jsdom 이 잴 수 없어
// 그 spec 의 @layout 1건으로 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { issueDetailHandlers } from '@/test/kits/projects/issueDetailEvents'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { IssueAiContext, IssueDetailResponse } from '@/types/issue'

import { createUser } from '../../../e2e/factories/auth.factory'
import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'

const KEY = 'PROJ'
const URL = `/projects/${KEY}/issues/1`
const detailWith = (aiContext: IssueAiContext) => createIssueDetail({ summary: createIssue({ projectKey: KEY }), aiContext })
const EMPTY: IssueAiContext = { summary: null, nextAction: null, generatedAt: null, blockers: [] }

/** 상세를 띄우고 현황 카드가 보일 때까지 기다린다. */
async function open(detail: IssueDetailResponse | (() => IssueDetailResponse), extra: Parameters<typeof issueDetailHandlers>[0]['extra'] = []) {
  const view = renderPage(URL, { handlers: issueDetailHandlers({ key: KEY, detail, extra }) })
  const card = await screen.findByTestId('issue-instant-context', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return { ...view, card }
}

describe('이슈 Instant Context 카드', () => {
  test('aiContext 가 있으면 요약·블로커 배지·다음 액션을 보인다', async () => {
    const { card } = await open(
      detailWith({ summary: '리뷰 대기 중 — 3일째 변화 없음', nextAction: '리뷰어 지정', generatedAt: new Date().toISOString(), blockers: [{ type: 'OVERDUE', message: '내일 마감' }] }),
    )
    expect(card).toHaveTextContent('리뷰 대기 중 — 3일째 변화 없음')
    expect(within(card).getByTestId('issue-blocker-badges')).toBeInTheDocument()
    expect(within(card).getByTestId('blocker-OVERDUE')).toBeInTheDocument()
    expect(within(card).getByTestId('issue-next-action')).toHaveTextContent('리뷰어 지정')
  })

  // 카드는 <details> — 헤더(summary)를 누르면 접히고 다시 누르면 펼쳐진다.
  test('헤더 클릭으로 접고 펼친다', async () => {
    const { card, user } = await open(detailWith({ summary: '리뷰 대기 중', nextAction: '리뷰어 지정', generatedAt: new Date().toISOString(), blockers: [] }))
    const details = card.closest('details') ?? card
    expect(details).toHaveAttribute('open')
    await user.click(card.querySelector('summary')!)
    expect(details).not.toHaveAttribute('open')
    await user.click(card.querySelector('summary')!)
    expect(details).toHaveAttribute('open')
  })

  test('저장본이 없어도 카드는 그려지고 「생성」 버튼이 있다', async () => {
    const { card } = await open(detailWith(EMPTY))
    expect(within(card).getByTestId('issue-summary-generate')).toHaveTextContent('생성')
  })

  // 생성 → POST ai-summary 진행 중엔 버튼 잠김(생성 중…) → 끝나면 상세 재조회로 요약이 카드에 보인다.
  test('생성 클릭 → POST(진행 중 잠김) → 재조회 → 요약 표시', async () => {
    let posted = 0
    const after = detailWith({ summary: '테스트용 AI 현황 요약 텍스트', nextAction: '코드 리뷰 요청', generatedAt: new Date().toISOString(), blockers: [] })
    const before = detailWith(EMPTY)
    const { card, user } = await open(() => (posted ? after : before), [
      http.post(`/api/v1/projects/${KEY}/issues/1/ai-summary`, async () => {
        await delay(300)
        posted++
        return HttpResponse.json(after.aiContext)
      }),
    ])
    const btn = within(card).getByTestId('issue-summary-generate')
    expect(btn).toBeEnabled()
    await user.click(btn)
    await waitFor(() => expect(btn).toBeDisabled())
    expect(btn).toHaveTextContent('생성 중…')
    expect(await within(card).findByText('테스트용 AI 현황 요약 텍스트')).toBeInTheDocument()
    expect(posted).toBe(1)
  })

  test('요약이 없어도 블로커 배지는 바로 보이고 생성 버튼도 함께 있다', async () => {
    const { card } = await open(detailWith({ ...EMPTY, blockers: [{ type: 'BLOCKED', message: '선행 이슈 미완료' }] }))
    expect(within(card).getByTestId('blocker-BLOCKED')).toBeInTheDocument()
    expect(within(card).getByTestId('issue-summary-generate')).toBeInTheDocument()
  })

  test('aiAvailable=false 사용자에겐 카드를 그리지 않는다', async () => {
    renderPage(URL, {
      user: createUser({ aiAvailable: false }),
      handlers: issueDetailHandlers({ key: KEY, detail: detailWith({ ...EMPTY, summary: '요약 있음', generatedAt: new Date().toISOString() }) }),
    })
    await screen.findByTestId('issue-title-edit', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(screen.queryByTestId('issue-instant-context')).not.toBeInTheDocument()
  })
})
