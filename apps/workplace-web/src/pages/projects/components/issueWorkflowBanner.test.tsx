// 워크플로우 사람 차례 배너(WP-1989) — 결과 고르기·넘기기·「답으로 보내기」.
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'

import { IssueWorkflowBanner } from './IssueWorkflowBanner'

const API = '/api/v1'
const me = { id: 1, username: 'me', name: '나', kind: 'HUMAN' }
const outcome = (o: object = {}) => ({ key: 'answered', toNode: 'dev', requiredOutputs: [], requireComment: false, assignTo: null, candidateAssignees: [], assigneeRequired: null, ...o })
function run(over: object = {}) {
  return {
    runId: 11,
    status: 'WAITING',
    revision: 4,
    workflowId: 5,
    versionNo: 7,
    currentNode: { key: 'dev_ask', name: '구현 질문 답변', type: 'human_task', roleKey: null, assignees: [me], enteredAt: new Date().toISOString(), nodeRunStatus: 'ACTIVE', instructions: null },
    outcomes: [outcome()],
    path: [],
    remainingNodeKeys: [],
    // 서버 실제 모양 — askedBy 는 숫자 id, question 은 저장된 댓글 본문.
    context: { _qa: [{ askNode: 'dev', answerNode: 'dev_ask', question: '최대 크기를 얼마로 할까요?', askedBy: 9 }] },
    ...over,
  }
}

function setup(view: object | ((gets: number) => object), moves: Record<string, unknown>[] = [], props: { meId?: number; posted?: { body: string; at: number } | null } = {}, moveStatus = 200, counter?: { gets: number }) {
  renderScreen(<IssueWorkflowBanner issueId={7} projectKey="WP" meId={props.meId ?? 1} posted={props.posted} />, {
    handlers: [
      http.get(`${API}/issues/7/workflow`, () => {
        if (counter) counter.gets++
        return HttpResponse.json(typeof view === 'function' ? view(counter?.gets ?? 0) : view)
      }),
      http.post(`${API}/issues/7/workflow/move`, async ({ request }) => {
        moves.push((await request.json()) as Record<string, unknown>)
        if (moveStatus === 409) return HttpResponse.json({ errors: { code: 'WORKFLOW_STALE' }, message: 'stale' }, { status: 409 })
        return HttpResponse.json(run())
      }),
    ],
  })
}

describe('워크플로우 사람 차례 배너', () => {
  test('humanTurn_bannerOnlyForAssignee_andOutcomeButtons', async () => {
    setup(run())
    expect(await screen.findByText('구현 질문 답변 — 내 차례')).toBeInTheDocument()
    expect(screen.getByText('「최대 크기를 얼마로 할까요?」')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'answered' })).toBeInTheDocument()
  })

  test('humanTurn_notAssignee_noBanner', async () => {
    const counter = { gets: 0 }
    setup(run(), [], { meId: 99 }, 200, counter)
    await waitFor(() => expect(counter.gets).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('issue-workflow-banner')).not.toBeInTheDocument()
  })

  test('requireComment_blocksSubmitUntilFilled', async () => {
    const moves: Record<string, unknown>[] = []
    setup(run({ outcomes: [outcome({ requireComment: true })] }), moves)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'answered' }))
    expect(screen.getByRole('button', { name: '넘기기' })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: '의견' }), '25MB')
    expect(screen.getByRole('button', { name: '넘기기' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '넘기기' }))
    await waitFor(() =>
      expect(moves).toEqual([{ fromNode: 'dev_ask', outcome: 'answered', comment: '25MB', expectedRevision: 4, runId: 11, idempotencyKey: 'web:7:dev_ask:4:answered' }]),
    )
  })

  test('requiredOutputs_sentTyped', async () => {
    const moves: Record<string, unknown>[] = []
    setup(run({ outcomes: [outcome({ requiredOutputs: [{ key: 'size', type: 'number' }, { key: 'ok', type: 'boolean' }] })] }), moves)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'answered' }))
    expect(screen.getByRole('button', { name: '넘기기' })).toBeDisabled()
    await user.type(screen.getByLabelText('size'), '3')
    await user.click(screen.getByRole('checkbox', { name: 'ok' }))
    await user.click(screen.getByRole('button', { name: '넘기기' }))
    await waitFor(() => expect(moves).toHaveLength(1))
    expect(moves[0].outputs).toEqual({ size: 3, ok: true })
  })

  test('changeOutcome_clearsAssigneeAndOutputs', async () => {
    const moves: Record<string, unknown>[] = []
    const cand = { id: 5, username: 'c', name: '후보', kind: 'HUMAN' }
    setup(run({ outcomes: [
      outcome({ key: 'a', candidateAssignees: [cand], assigneeRequired: true, requiredOutputs: [{ key: 'memo', type: 'string' }] }),
      outcome({ key: 'b', candidateAssignees: [{ ...cand, id: 6, name: '다른후보' }], assigneeRequired: false }),
    ] }), moves)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'a' }))
    await user.click(screen.getByRole('radio', { name: '후보' }))
    await user.type(screen.getByLabelText('memo'), 'x')
    await user.click(screen.getByRole('button', { name: 'b' }))
    await user.click(screen.getByRole('button', { name: '넘기기' }))
    await waitFor(() => expect(moves).toHaveLength(1))
    // b 로 바꾸면 a 에서 고른 담당·출력은 실리지 않는다.
    expect(moves[0].assigneeIds).toBeUndefined()
    expect(moves[0].outputs).toBeUndefined()
  })

  test('urlOutput_requiresParsableUrl', async () => {
    setup(run({ outcomes: [outcome({ requiredOutputs: [{ key: 'link', type: 'url' }] })] }))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'answered' }))
    await user.type(screen.getByLabelText('link'), 'not a url')
    expect(screen.getByRole('button', { name: '넘기기' })).toBeDisabled()
    await user.clear(screen.getByLabelText('link'))
    await user.type(screen.getByLabelText('link'), 'https://example.com/a')
    expect(screen.getByRole('button', { name: '넘기기' })).toBeEnabled()
  })

  // 서버(OutputRules)와 같게 host 있는 http(s) 만 url — 'abc:def'·'javascript:x' 는 거절.
  test('urlOutput_rejectsNonHttpSchemes', async () => {
    setup(run({ outcomes: [outcome({ requiredOutputs: [{ key: 'link', type: 'url' }] })] }))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'answered' }))
    for (const bad of ['abc:def', 'javascript:x']) {
      await user.clear(screen.getByLabelText('link'))
      await user.type(screen.getByLabelText('link'), bad)
      expect(screen.getByRole('button', { name: '넘기기' })).toBeDisabled()
    }
    await user.clear(screen.getByLabelText('link'))
    await user.type(screen.getByLabelText('link'), 'https://a.b/c')
    expect(screen.getByRole('button', { name: '넘기기' })).toBeEnabled()
  })

  // 들어온 시각을 모르면 오래된 글이 답 후보가 되지 않게 단추를 숨긴다.
  test('enteredAtNull_noSendAsAnswerButton', async () => {
    const base = run()
    setup(run({ currentNode: { ...(base.currentNode as object), enteredAt: null } }), [], { posted: { body: '글', at: Date.now() } })
    await screen.findByRole('button', { name: 'answered' })
    expect(screen.queryByRole('button', { name: '방금 쓴 글을 답으로 보내기' })).not.toBeInTheDocument()
  })

  test('move_doubleClick_sendsOnceWithSameKey', async () => {
    const moves: Record<string, unknown>[] = []
    setup(run(), moves)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'answered' }))
    const btn = screen.getByRole('button', { name: '넘기기' })
    // 같은 틱에 두 번 — disabled 가 아니라 ref 방어가 막는지 본다.
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await waitFor(() => expect(moves).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 50))
    expect(moves).toHaveLength(1)
  })

  test('staleMove_showsRefreshMessage', async () => {
    const counter = { gets: 0 }
    // 재조회는 revision 5·다른 사람 노드를 돌려준다 — 배너가 사라지고 key 가 바뀌어도 안내는 남아야 한다.
    const next = run({ revision: 5, currentNode: { ...run().currentNode, key: 'other', assignees: [{ ...me, id: 2 }] } })
    setup((gets) => (gets <= 1 ? run() : next), [], {}, 409, counter)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'answered' }))
    await user.click(screen.getByRole('button', { name: '넘기기' }))
    expect(await screen.findByText('그사이 단계가 바뀌었어요. 새로 불러왔어요.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('issue-workflow-banner')).not.toBeInTheDocument())
    expect(screen.getByText('그사이 단계가 바뀌었어요. 새로 불러왔어요.')).toBeInTheDocument()
  })

  test('answerNodeActive_humanChatPost_offersSendAsAnswer_noAutoMove', async () => {
    const moves: Record<string, unknown>[] = []
    setup(run(), moves, { posted: { body: '25MB 로 해 주세요', at: Date.now() + 1000 } })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '방금 쓴 글을 답으로 보내기' }))
    expect(await screen.findByDisplayValue('25MB 로 해 주세요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '넘기기' })).toBeEnabled()
    expect(moves).toHaveLength(0)
  })

  test('postedBeforeNodeEntered_noSendAsAnswerButton', async () => {
    setup(run(), [], { posted: { body: '옛 글', at: Date.now() - 3_600_000 } })
    await screen.findByText('구현 질문 답변 — 내 차례')
    expect(screen.queryByRole('button', { name: '방금 쓴 글을 답으로 보내기' })).not.toBeInTheDocument()
  })

  // 브라우저 시계가 서버보다 늦어도(노드 진입 30초 전으로 보여도) 1분 여유 안이면 후보로 본다.
  test('postedWithinClockSkew_stillOffersSendAsAnswer', async () => {
    setup(run(), [], { posted: { body: '시계가 느린 글', at: Date.now() - 30_000 } })
    expect(await screen.findByRole('button', { name: '방금 쓴 글을 답으로 보내기' })).toBeInTheDocument()
  })

  test('assigneeRequired_noCandidates_showsReason', async () => {
    setup(run({ outcomes: [outcome({ assigneeRequired: true })] }))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'answered' }))
    expect(screen.getByText('넘길 수 있는 담당 후보가 없어요. 프로젝트 관리자에게 알려 주세요.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '넘기기' })).toBeDisabled()
  })

  test('assigneeRequired_pickCandidate_sendsAssigneeIds', async () => {
    const moves: Record<string, unknown>[] = []
    const dev = { id: 5, username: 'dev', name: '개발자', kind: 'HUMAN' }
    setup(run({ outcomes: [outcome({ assigneeRequired: true, candidateAssignees: [dev, { ...dev, id: 6, name: '다른이' }] })] }), moves)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'answered' }))
    expect(screen.getByRole('button', { name: '넘기기' })).toBeDisabled()
    await user.click(within(screen.getByRole('radiogroup', { name: '다음 담당' })).getByRole('radio', { name: '개발자' }))
    await user.click(screen.getByRole('button', { name: '넘기기' }))
    await waitFor(() => expect(moves).toHaveLength(1))
    expect(moves[0].assigneeIds).toEqual([5])
  })

  // WP-2060 — 결과를 고르면 스크린리더가 고른 결과·아래 폼을 듣는다(aria-pressed·status·group).
  test('outcome_pick_announcesFormAndPressedState', async () => {
    setup(run({ outcomes: [outcome({ key: 'a', requireComment: true }), outcome({ key: 'b' })] }))
    const user = userEvent.setup()
    const banner = await screen.findByTestId('issue-workflow-banner')
    const status = within(banner).getByRole('status')
    expect(status).toHaveTextContent(/^$/)
    expect(screen.getByRole('button', { name: 'a' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: 'a' }))
    expect(screen.getByRole('button', { name: 'a' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'b' })).toHaveAttribute('aria-pressed', 'false')
    expect(status).toHaveTextContent('「a」 결과를 골랐어요. 아래에서 의견(필수)을 적고 넘기기를 누르세요.')
    expect(screen.getByRole('group', { name: '「a」 결과 입력' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'b' }))
    expect(status).toHaveTextContent('「b」 결과를 골랐어요. 아래에서 의견을 적고 넘기기를 누르세요.')
    expect(screen.getByRole('group', { name: '「b」 결과 입력' })).toBeInTheDocument()
  })

  test('outcome_pick_announcesRequiredFieldsAndNoCandidate', async () => {
    const cand = { id: 5, username: 'dev', name: '개발자', kind: 'HUMAN' }
    setup(run({ outcomes: [
      outcome({ key: 'a', requiredOutputs: [{ key: 'link', type: 'url' }], assigneeRequired: true, candidateAssignees: [cand] }),
      outcome({ key: 'b', assigneeRequired: true }),
    ] }))
    const user = userEvent.setup()
    const status = within(await screen.findByTestId('issue-workflow-banner')).getByRole('status')
    await user.click(screen.getByRole('button', { name: 'a' }))
    expect(status).toHaveTextContent('「a」 결과를 골랐어요. 아래에서 필수 항목(link·다음 담당)을 채우고 의견을 적고 넘기기를 누르세요.')
    await user.click(screen.getByRole('button', { name: 'b' }))
    expect(status).toHaveTextContent('「b」 결과를 골랐어요. 넘길 수 있는 담당 후보가 없어 넘길 수 없어요.')
  })

  test('header_showsElapsedSinceEntered', async () => {
    setup(run())
    expect(await screen.findByText('· 방금 전')).toBeInTheDocument()
  })
})
