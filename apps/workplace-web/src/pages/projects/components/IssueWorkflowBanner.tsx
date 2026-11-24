// 워크플로우 사람 차례 배너(WP-1989) — 내가 담당인 사람 노드(human_task)에서 결과를 골라 다음 단계로 넘긴다.
// 왜: 노드는 사람이 옮기기 전에는 저절로 바뀌지 않는다. 질문이 와 있으면 그 글을 같이 보이고, 방금 쓴 코멘트·채팅 글을 의견으로 실어 보낼 수 있다.
// 보일 조건(WAITING · human_task · 내가 담당)이 아니면 아무것도 그리지 않는다.
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { focusRow } from '@/hooks/useListFocusRescue'
// 초점을 잃었을 때만 옮긴다 — 넘긴 뒤 재조회가 오기 전에 사용자가 다른 곳(코멘트 편집기 등)으로 옮겼으면 그 자리를 뺏지 않는다(WP-2055).
import { focusLostOrDetached as focusIsLost } from '@/hooks/useRestoreFocusOnExit'
import { extractApiErrorCode } from '@/lib/api-error'
import { formatRelativeTime, parseUtcDate } from '@/lib/formatters'
import {
  type IssueWorkflowView,
  useIssueWorkflow,
  useMoveIssueWorkflow,
  workflowErrorMessage,
  type WorkflowNodeView,
  type WorkflowOutcomeView,
} from '@/lib/workflow'
import { pendingQuestion } from '@/lib/workflowRuns'

interface Props {
  issueId: number
  projectKey: string
  meId: number
  /** 방금 코멘트·채팅에 쓴 글과 쓴 시각(ms) — 지금 노드에 들어온 뒤의 글만 「답으로 보내기」로 의견 칸에 담는다. */
  posted?: { body: string; at: number } | null
  /** 글을 의견으로 가져갔다 — 부모가 비운다. */
  onPostedBodyUsed?: () => void
  /** 내가 넘긴 뒤 배너가 더는 보이지 않게 됐을 때 한 번 불린다(WP-2055) — 부모가 초점을 둘 곳을 정한다. */
  onLeave?: () => void
}

/**
 * 「방금 넘김」 표지의 수명(ms, WP-2055 리뷰 후속) — 넘긴 뒤 재조회가 실패하거나 끝내 새 revision 이 오지 않아도
 * 표지가 남아 나중에 남이 옮긴 것까지 내가 넘긴 것으로 오해해 초점을 뺏지 않게 한다.
 */
const MOVED_TTL_MS = 10_000

/** 브라우저·서버 시계 차이 여유 — 「답으로 보내기」 후보 판정에만 쓴다. */
const CLOCK_SKEW_MS = 60_000

/** URL 인가 — 서버(OutputRules)와 같게 host 가 있는 http(s) 만 받는다('abc:def'·'javascript:x' 는 거절). */
function isUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== ''
  } catch {
    return false
  }
}

type RequiredOutput = WorkflowOutcomeView['requiredOutputs'][number]

/**
 * 필수 출력 하나를 검사하고 보낼 값으로 바꾼다 — 검사(넘기기 단추 활성)와 변환(보내기)이 같은 type 분기를 쓰게 한 곳에 둔다.
 * boolean 은 늘 유효(체크 안 함 = false), number 는 숫자로 읽혀야, url 은 URL 이어야, string 은 비어 있지 않아야 한다.
 */
function readOutput(o: RequiredOutput, raw: string | boolean | undefined): { valid: boolean; value: unknown } {
  if (o.type === 'boolean') return { valid: true, value: raw === true }
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (o.type === 'number') return { valid: s !== '' && !Number.isNaN(Number(s)), value: Number(s) }
  if (o.type === 'url') return { valid: isUrl(s), value: s }
  return { valid: s !== '', value: s }
}

export function IssueWorkflowBanner({ issueId, projectKey, meId, posted, onPostedBodyUsed, onLeave }: Props) {
  const view = useIssueWorkflow(issueId)
  const run = view.data
  const cur = run?.currentNode
  // 내가 넘기는 중·넘겼는지(WP-2055) — 넘긴 뒤 새 본문이 뜨면 제목으로 초점을 옮기고, 배너가 사라지면 onLeave 를 부른다.
  // 표지는 넘기기 요청 **전에** 세운다(리뷰 후속) — 성공 처리(재조회 대기)가 끝나기 전에 새 revision 이 먼저 와도 표지를 놓치지 않게.
  // 요청이 실패하면(409 낡음 빼고) 지우고, 재조회가 실패하거나 새 revision 이 오지 않아도 MOVED_TTL_MS 뒤에는 쓰지 않는다.
  // doneAt: 넘기기 응답을 받은 시각 — 그 뒤에 끝난 재조회도 같은 revision 이면 바뀐 것이 없어 표지를 지운다.
  const movedRef = useRef<{ key: string; at: number; doneAt?: number } | null>(null)
  /** 아직 유효한 표지 — 수명이 지났으면 지우고 null. */
  const liveMoved = () => {
    const moved = movedRef.current
    // 수명은 응답을 받은 뒤부터 센다 — 요청이 느려도 응답 전에 표지가 사라져 초점 잇기를 놓치지 않게.
    if (moved && Date.now() - (moved.doneAt ?? moved.at) > MOVED_TTL_MS) movedRef.current = null
    return movedRef.current
  }
  // 다른 이슈로 바뀌면(같은 화면에서 이슈 이동) 앞 이슈의 표지를 버린다 — 새 이슈의 상태 변화를 내 떠남으로 보지 않게.
  useEffect(() => {
    movedRef.current = null
  }, [issueId])
  // 언마운트 때 쓸 최신 onLeave — 부모(실행 상세)가 배너를 통째로 내리는 경우에도 떠남을 알린다.
  const onLeaveRef = useRef(onLeave)
  useEffect(() => {
    onLeaveRef.current = onLeave
  }, [onLeave])
  const viewKey = run?.runId != null ? `${run.runId}:${run.revision}` : null
  const dataUpdatedAt = view.dataUpdatedAt
  const visible =
    !!run && run.runId != null && run.status === 'WAITING' && !!cur && cur.type === 'human_task' && cur.assignees.some((a) => a.id === meId)
  useEffect(() => {
    const moved = liveMoved()
    if (!moved) return
    if (viewKey === moved.key) {
      // 같은 상태 — 응답 뒤에 끝난 재조회도 그대로면 지운다. 넘기는 중·재조회 전이면 기다린다(남은 표지는 수명이 지나면 버린다).
      if (moved.doneAt != null && dataUpdatedAt >= moved.doneAt) movedRef.current = null
      return
    }
    // 상태가 달라졌다 — 보이면 새 본문의 마운트 효과가 이미 초점을 처리했고, 안 보이면 내가 넘겨 떠난 것이다. 어느 쪽이든 표지는 지운다.
    movedRef.current = null
    if (!visible && focusIsLost()) onLeave?.()
  }, [viewKey, visible, dataUpdatedAt, onLeave])
  useEffect(
    () => () => {
      // 넘긴 뒤 부모가 이 배너를 먼저 내렸다(실행 상세가 담당이 바뀐 것을 먼저 읽음) — 지워진 단추에서 초점이 body 로 떨어지므로,
      // DOM 이 정리된 다음 틱에 초점을 잃었는지 보고 onLeave 를 부른다.
      if (!liveMoved()) return
      movedRef.current = null
      setTimeout(() => {
        if (focusIsLost()) onLeaveRef.current?.()
      }, 0)
    },
    // 언마운트 때 한 번만.
    [],
  )
  if (!visible || !run || run.runId == null || !cur) return null
  // 노드·revision 이 바뀌면 입력을 새로 시작한다(key). 검증한 지금 노드·실행 id 를 그대로 넘긴다.
  const bodyKey = `${run.runId}:${run.revision}`
  return (
    <BannerBody
      key={bodyKey}
      run={run}
      cur={cur}
      runId={run.runId}
      issueId={issueId}
      projectKey={projectKey}
      posted={posted}
      onPostedBodyUsed={onPostedBodyUsed}
      onMoving={() => {
        movedRef.current = { key: bodyKey, at: Date.now() }
      }}
      onMoved={() => {
        // 응답 시각을 적는다 — 그 뒤 재조회가 같은 revision 을 돌려주면 위 효과가 표지를 지운다.
        if (movedRef.current) movedRef.current.doneAt = Date.now()
      }}
      onMoveFailed={() => {
        movedRef.current = null
      }}
      takeMoved={() => {
        // 넘긴 revision 과 다른 본문이 새로 마운트됐을 때만 초점을 옮긴다.
        const moved = liveMoved()
        if (!moved || moved.key === bodyKey) return false
        movedRef.current = null
        return true
      }}
    />
  )
}

function BannerBody({
  run,
  cur,
  runId,
  issueId,
  projectKey,
  posted,
  onPostedBodyUsed,
  onMoving,
  onMoved,
  onMoveFailed,
  takeMoved,
}: Omit<Props, 'meId' | 'onLeave'> & {
  run: IssueWorkflowView
  cur: WorkflowNodeView
  runId: number
  /** 넘기기 요청 직전 — 「방금 넘김」 표지를 세운다. */
  onMoving: () => void
  /** 넘기기 요청이 성공했다(재조회는 이 뒤에 끝날 수 있다). */
  onMoved: () => void
  /** 넘기기가 실패했다(낡은 화면 409 빼고) — 표지를 지운다. */
  onMoveFailed: () => void
  /** 내가 넘긴 직후의 마운트인지 읽고 지운다 — 렌더 중에 ref 를 읽지 않으려 마운트 효과에서만 부른다. */
  takeMoved: () => boolean
}) {
  const move = useMoveIssueWorkflow(issueId, projectKey)
  const [picked, setPicked] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [outputs, setOutputs] = useState<Record<string, string | boolean>>({})
  const [assigneeId, setAssigneeId] = useState<number | null>(null)
  // 빠른 두 번 클릭 방어 — 상태 갱신 전에 들어오는 두 번째 클릭을 막는다.
  const sending = useRef(false)
  // 제목 — 넘긴 뒤 새 단계가 뜨면 여기로 초점을 옮긴다(WP-2055: 눌렀던 단추가 사라져 초점이 body 로 떨어지는 것을 막는다).
  const titleRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // takeMoved 는 표지를 지우므로 항상 먼저 부른다 — 초점이 이미 다른 곳에 있으면 옮기지 않는다.
    if (takeMoved() && titleRef.current && focusIsLost()) focusRow(titleRef.current)
    // 마운트 때 한 번만 — 이후 렌더에서 초점을 다시 뺏지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const q = pendingQuestion(run.context, cur.key)
  const outcome: WorkflowOutcomeView | undefined = run.outcomes.find((o) => o.key === picked)

  // 결과 값이 갖춰졌는지 — 필수 의견·필수 출력·필수 담당.
  const outputsOk = (outcome?.requiredOutputs ?? []).every((o) => readOutput(o, outputs[o.key]).valid)
  const commentOk = !outcome?.requireComment || comment.trim() !== ''
  const assigneeOk = !outcome?.assigneeRequired || assigneeId != null
  const canSubmit = outcome != null && outputsOk && commentOk && assigneeOk && !move.isPending

  // 이 노드에 들어온 뒤에 쓴 글만 답 후보 — 몇 시간 전 글이 「방금 쓴 글」로 뜨지 않게 한다.
  // 글 시각은 브라우저 시계, enteredAt 은 서버 시계라 차이가 날 수 있어 1분 여유를 둔다(늦은 시계에서 버튼이 숨는 것을 막는다).
  // enteredAt 을 모르면 후보로 보지 않는다(0 으로 두면 오래된 글이 후보가 된다).
  const enteredMs = cur.enteredAt ? parseUtcDate(cur.enteredAt).getTime() - CLOCK_SKEW_MS : null
  const postedBody = posted && enteredMs != null && posted.at >= enteredMs ? posted.body : null
  // 필수 담당인데 고를 후보가 없으면 넘길 수 없다 — 이유를 보인다.
  const noCandidate = outcome?.assigneeRequired === true && outcome.candidateAssignees.length === 0

  // 결과를 바꾸면 이전 결과에서 채운 담당·출력은 비운다 — 다른 결과의 후보 밖 사람이 그대로 실려 가지 않게.
  function pick(key: string) {
    if (key !== picked) {
      setAssigneeId(null)
      setOutputs({})
    }
    setPicked(key)
  }

  // 방금 쓴 글을 의견 칸에 담는다(훅이 아니라 이벤트 처리 함수).
  function applyPostedBody() {
    if (postedBody == null) return
    // 결과가 하나뿐이면 자동 선택 — 넘기기는 사람이 직접 누른다.
    if (run.outcomes.length === 1) pick(run.outcomes[0].key)
    setComment(postedBody)
    onPostedBodyUsed?.()
  }

  async function submit() {
    if (!outcome || sending.current) return
    sending.current = true
    try {
      // 요청 전에 표지를 세운다 — 성공 처리(재조회)가 mutateAsync 보다 먼저 끝나 새 본문이 마운트돼도 초점을 잇는다.
      onMoving()
      const typed = Object.fromEntries(outcome.requiredOutputs.map((o) => [o.key, readOutput(o, outputs[o.key]).value]))
      await move.mutateAsync({
        fromNode: cur.key,
        outcome: outcome.key,
        outputs: outcome.requiredOutputs.length > 0 ? typed : undefined,
        // 고른 결과의 후보에 있는 사람만 보낸다(방어).
        assigneeIds: assigneeId != null && outcome.candidateAssignees.some((u) => u.id === assigneeId) ? [assigneeId] : undefined,
        comment: comment.trim() !== '' ? comment.trim() : undefined,
        expectedRevision: run.revision,
        runId,
      })
      onMoved()
      toast.success('다음 단계로 넘겼어요.')
    } catch (e) {
      // 낡은 화면(409 WORKFLOW_STALE)이면 훅이 새로 읽어 revision 이 바뀌고 본문이 다시 마운트된다 — 표지를 남겨 새 제목(또는 떠남)으로 초점을 잇는다.
      // 그 밖의 실패는 상태가 그대로라 표지를 지운다(남겨 두면 나중에 남이 옮긴 것에 초점을 뺏는다).
      // 낡음이면 응답 시각을 적어, 다시 읽은 것이 같은 revision 이면 표지가 지워지게 한다.
      if (extractApiErrorCode(e) === 'WORKFLOW_STALE') onMoved()
      else onMoveFailed()
      // 안내는 toast 로 — 재조회로 revision 이 바뀌면 이 컴포넌트가 key 로 새로 마운트돼 안의 상태는 지워진다.
      toast.error(workflowErrorMessage(e, '다음 단계로 넘기지 못했어요.'))
    } finally {
      sending.current = false
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-warning/40 bg-warning-subtle p-3 text-sm" data-testid="issue-workflow-banner">
      <div ref={titleRef} data-testid="issue-workflow-banner-title" className="font-medium text-warning-text">{`${cur.name ?? cur.key} — 내 차례`}
        {cur.enteredAt && <span className="ml-1 text-xs font-normal">{`· ${formatRelativeTime(cur.enteredAt)}`}</span>}
      </div>
      {q && <p>{`「${q}」`}</p>}
      {cur.instructions && <p className="text-xs text-muted-foreground">{cur.instructions}</p>}
      <div className="flex flex-wrap gap-2">
        {run.outcomes.map((o) => (
          <Button key={o.key} type="button" size="sm" variant={picked === o.key ? 'default' : 'outline'} onClick={() => pick(o.key)}>
            {o.key}
          </Button>
        ))}
      </div>
      {postedBody != null && postedBody.trim() !== '' && (
        <Button type="button" size="sm" variant="outline" onClick={applyPostedBody}>
          방금 쓴 글을 답으로 보내기
        </Button>
      )}
      {outcome && (
        <div className="space-y-2">
          {outcome.requiredOutputs.map((o) => (
            <label key={o.key} className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">{o.key}</span>
              {o.type === 'boolean' ? (
                <Checkbox
                  aria-label={o.key}
                  checked={outputs[o.key] === true}
                  onCheckedChange={(c) => setOutputs((s) => ({ ...s, [o.key]: c === true }))}
                />
              ) : (
                <Input
                  aria-label={o.key}
                  type={o.type === 'number' ? 'number' : 'text'}
                  value={typeof outputs[o.key] === 'string' ? (outputs[o.key] as string) : ''}
                  onChange={(e) => setOutputs((s) => ({ ...s, [o.key]: e.target.value }))}
                />
              )}
            </label>
          ))}
          {outcome.candidateAssignees.length > 0 && (
            <RadioGroup
              aria-label="다음 담당"
              value={assigneeId != null ? String(assigneeId) : ''}
              onValueChange={(v) => setAssigneeId(Number(v))}
              className="space-y-1"
            >
              {outcome.candidateAssignees.map((u) => (
                <label key={u.id} className="flex cursor-pointer items-center gap-2">
                  <RadioGroupItem value={String(u.id)} aria-label={u.name} />
                  {u.name}
                </label>
              ))}
            </RadioGroup>
          )}
          {noCandidate && <p className="text-xs text-muted-foreground">넘길 수 있는 담당 후보가 없어요. 프로젝트 관리자에게 알려 주세요.</p>}
          <Textarea
            aria-label="의견"
            placeholder={outcome.requireComment ? '의견을 꼭 적어 주세요' : '의견(선택)'}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
          />
          <Button type="button" size="sm" disabled={!canSubmit} onClick={submit}>
            넘기기
          </Button>
        </div>
      )}
    </div>
  )
}
