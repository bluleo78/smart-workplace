// AI 작업 단계 카드의 단계 목록 순수 함수(WP-2160) — 실행 path·지금 단계·서버가 준 남은 단계를 「한 단계 한 줄」 목록으로 계산한다.
// 카드는 결과만 그리기 때문에 계산 회귀는 이 모듈의 vitest 로 잡는다. 규칙:
// - 행 순서: 방문 순서(path 고유, 질문 노드 제외) → 지금 단계 → 남은 단계. 남은 단계는 정의의 본 흐름을 다시 그리지 않고
//   서버 `remainingNodeKeys`(WorkflowRunViews.remaining — 지금 노드 기준 BFS) 를 그대로 쓴다 — 본 흐름 전체를 그리면
//   분기로 나간 실행에 안 간 단계가 남은 단계로 보이기 때문이다(WP-2160 리뷰 ①).
// - 되돌린 실행(리뷰 후속 ①): 남은 단계는 방문보다 앞선다 — 이미 지나온 단계도 되돌리면 다시 남은 단계라 방문(✓)으로 갈리면
//   되돌아간 뒤의 단계가 ✓ 로 남는다. 남은 단계 키는 방문 자리에서 빼 뒤로 미루므로 지금 행도 남은 단계보다 앞에 온다.
// - 분기 제외: 본 흐름 밖이고 방문한 적 없는 분기 노드는 남은 단계에 없으므로 줄을 만들지 않는다 — 이미 고른 흐름이 아니므로.
// - 방문 수: 서버 path(지금 노드 자신은 뺀 나머지) 에 이미 세어진 값만 쓰고, +1 을 더할 칸은 지금 노드가 그 행 자신일뿐이다 —
//   질문 노드가 원래 단계로 접힌 칸은 path 에 방문이 남아 있어 중복 가산하면 안 된다.
// - 상태는 방문 여부와 남은 단계 키로 갈린다(리뷰 ② — 남은 단계 키가 이긴다): 완료(COMPLETED)라도 방문하지 않은 행은 ✓ 가 아니다 —
//   갈 수 없는 본 흐름 행이 남은 단계로 섞여 있을 때 전부 ✓ 로 과장되지 않게. 완료는 끝 행에만 도착 시각을 더한다(완료 기준 「완료 실행은 모든 단계 ✓ 와 걸린 시간」),
//   취소(CANCELED)는 도달한 줄만 ✓ ·안 간 줄은 남음 ·지금 표식 없음 ·끝 행 도착 시각 없음이다.
// - 이름은 정의의 name 이 먼저고(버전 로딩·실패 시 없음) 그때 실행의 지금 노드·방문 기록 이름으로, 그것도 없으면 키로 떨어진다(리뷰 ③) —
//   정의를 못 읽는 동안에도 키만 보이지 않게 한다.
// - 질문 노드(returnTo 있음)는 줄 대신 원래 단계에 접는다: 접힌 칸이 곧 current (질문 대기 판정과 무관하게 항상 접는다 —
//   안 그러면 _ask 키가 행 걸림에서 빠져 현재 줄이 통째로 없어진다), 「질문 대기」 꾸밈(경고 메타·질문 첫 줄·챗 상자)은 질문 대기일 때만,
//   답한 질문 수는 context._qa 의 askNode 로 원래 단계 행에 센다.
//   정의를 못 읽는 동안(리뷰 후속 ②)에는 정의에서 returnTo 를 못 얻으니 지금 노드의 returnTo 와 _qa answerNode 로 같은 필터를 쓴다.
import { elapsedLabel } from './aiRoster'
import { formatClockTimeCompact } from './formatters'
import type { IssueWorkflowView, WorkflowUser } from './workflow'
import { pendingQuestion, questionFirstLine } from './workflowRuns'
import type { WorkflowModel } from './workflows'

/** 단계 행의 상태 — 지나왔는지·지금인지·남았는지. 방문 여부로 갈리되 남은 단계 키가 이긴다(되돌린 실행): 지금 → 지나온 줄 → 남은 줄. */
export type WorkflowStepState = 'passed' | 'current' | 'remaining'

/** 「AI 작업 단계」 카드의 단계 한 줄 — 계산 결과만 담고 그리기는 카드가 한다(WP-2160). */
export interface WorkflowStepRow {
  key: string
  /** 정의의 name → 실행의 지금·방문 이름 → 키(정의를 못 읽을 때도 키만 보이지 않게) */
  name: string
  state: WorkflowStepState
  /** 같은 단계 방문 수(지금 방문 포함) */
  visits: number
  /** 지금 '2번째' / 지난 '2번' — visits <= 1 이면 null */
  repeat: string | null
  /** 지금: 담당 / 지난: 그 방문의 actor / 시작 행: 시작자 */
  actors: WorkflowUser[]
  /** 머문·걸린 시간 또는 시작·도착 시각(HH:MM) */
  timeLabel: string | null
  /** 지금이 질문 대기(원래 단계로 접힘) */
  questionWaiting: boolean
  questionFirstLine: string | null
  /** 답한 질문 수 — 0 이면 그 줄을 그리지 않는다 */
  questionAnswered: number
  isStart: boolean
  isEnd: boolean
}

/**
 * 두 시각 사이 걸린 시간 — elapsedLabel 과 같은 단위(1분 미만 「방금」, 「n분」, 「H시간 M분」, 「n일」).
 * elapsedLabel 은 (기준 시각, now) 순서라 now 기본값(Date.now)이 붙지만 여기는 끝 시각을 인자로 받으므로 그대로 넘긴다(WP-2160).
 */
export function durationLabel(from: string, to: string): string {
  return elapsedLabel(from, Date.parse(to))
}

/**
 * 단계 목록 — 실행 view 와 실행이 고정한 버전의 정의로 카드가 그릴 행을 만든다(WP-2160).
 * 방문 먼저(질문 노드 제외) → 지금 → 서버가 준 남은 단계(remainingNodeKeys) 순으로 세우되, 되돌려 다시 남은 단계가 된 방문은
 * 남은 단계 쪽으로 옮긴다(리뷰 후속 ① — 지금 행이 남은 단계보다 앞에 오고 되돌아간 단계가 ✓ 로 남지 않는다).
 * 질문 노드는 질문 대기 여부와 무관하게 원래 단계로 접는다 — 정의를 못 읽는 동안에도 지금 노드 returnTo·_qa answerNode 로 같은 필터를 쓴다(리뷰 후속 ②).
 * 상태는 방문 여부와 남은 단계 키로 갈린다 — 완료 실행도 방문한 행만 passed + 끝 행 도착 시각, 취소 실행은 도달한 줄만 passed ·안 간 줄은 남음 ·도착 시각 없음이다.
 * 시각은 KST 고정 표기다(「째」 붙이기·질문 상자 그리기는 카드의 일).
 */
export function buildWorkflowStepRows(
  view: Pick<IssueWorkflowView, 'path' | 'currentNode' | 'status' | 'endedAt' | 'context' | 'remainingNodeKeys'>,
  model: WorkflowModel | undefined,
  // 시작 정보는 시각·시작자이며, 시작자에는 kind 도 함께 온다 — 에이전트 시작자는 Bot 표식의 근거다(디자인 시스템 07 §7.2).
  opts?: {
    start?: { name: string | null; at: string | null; kind?: WorkflowUser['kind'] | null } | null
    now?: number
    askWaiting?: boolean
  },
): WorkflowStepRow[] {
  const now = opts?.now ?? Date.now()
  const cur = view.currentNode
  const returnTo = cur?.returnTo ?? null
  // 질문 대기 판정 — 카드가 isAskWaiting 결과를 넘기면 그대로, 안 넘기면 여기가 낮은 층에서 같은 조건(사람 차례 + returnTo)으로 가른다.
  // 이제 이 값은 「질문 대기」 꾸밈(경고 메타·질문 첫 줄·챗 상자)에만 쓴다 — 현재 단계 접기는 질문 노드이기만 하면 항상 한다.
  const waiting = cur != null && returnTo != null && (opts?.askWaiting ?? view.status === 'WAITING')
  // 질문 노드의 현재 단계는 접힌 칸이 곧 현재다 — askWaiting 이 false 여도 returnTo 행을 current 로 잡는다.
  // 안 그러면 currentKey 가 _ask 키가 되어 행 걸림에서 빠지고, 사람 차례/조치 필요 칩과 맞는 현재 줄이 화면에서 통째로 없어진다.
  const currentKey = cur != null && returnTo != null ? returnTo : (cur?.key ?? null)
  // 끝난 실행(완료·취소) — 끝난 뒤에는 지금 표식을 쓰지 않는다(isCurrent·current 꾸밈 모두 차단).
  const ended = view.status === 'COMPLETED' || view.status === 'CANCELED'
  // 완료 — 끝 행에만 도착 시각을 더하는지 가르는 데 쓴다(취소 실행은 도착 시각 없음, 상태는 아래 visits 기준으로만 갈린다).
  const completed = view.status === 'COMPLETED'
  // 정의 노드를 한 번만 찾아 쓴다 — 이름·type(끝 단계)·질문 노드 판정이 다 여기서 나온다.
  const defs = new Map((model?.nodes ?? []).map((n) => [n.key, n] as const))

  // _qa — askNode 가 이 행인 질문 중 답이 채워진 것의 수(「질문 n건 · 답변함」 근거). 질문 노드 키(현재 줄에 접는 자리)도
  // answerNode 에서 얻으므로 필터보다 먼저 읽는다.
  const qa = Array.isArray(view.context['_qa'])
    ? (view.context['_qa'] as ({ askNode?: unknown; answerNode?: unknown; answer?: unknown } | null)[])
    : []

  // 질문 노드(returnTo 있는 노드) — 방문·남은 키 어디에서 오든 줄을 만들지 않는다(행 만들기 직전 필터로 한 번에 뺀다).
  // 정의를 못 읽는 동안(버전 로딩·404)에는 정의에서 returnTo 를 못 얻으니, 실행에서 알 수 있는 두 자리 — 지금 노드의 returnTo 가
  // 가리키는 접힘과 _qa answerNode — 를 같은 필터에 넣는다(리뷰 후속 ② — 정의 로딩 중 질문 노드가 한 줄로 남던 것을 막는다).
  const questionKeys = new Set([...defs.values()].filter((n) => n.returnTo != null).map((n) => n.key))
  if (cur?.returnTo != null) questionKeys.add(cur.key)
  for (const e of qa) if (typeof e?.answerNode === 'string') questionKeys.add(e.answerNode)

  // 남은 단계 집합 — 서버 remainingNodeKeys(지금 노드 제외·질문 경로 제외)를 방문(✓)보다 앞세운다(리뷰 후속 ①).
  // 되돌린 실행에서는 이미 지나온 단계도 다시 남은 단계라, 방문 여부로만 갈리면 되돌아간 뒤의 단계가 ✓ 로 남는다.
  // 끝난 실행은 서버가 remaining 을 비우므로(WorkflowRunViews.build — isActive 일 때만 남긴다) 완료·취소 실행의 ✓ 는 이 규칙의 영향 밖이다.
  const remainingKeys = new Set(view.remainingNodeKeys)

  // 행 순서 — 방문 중 남은 단계로 되돌아간 키는 남은 단계 쪽으로 옮긴 뒤 → 지금 → 서버가 준 남은 단계 순으로 세운다.
  // 남은 단계 키를 뒤로 미루므로 지금 행이 남은 단계보다 앞에 오고(지금 행 순서), 되돌아간 단계는 남은 단계 자리에서 다시 그려진다.
  const ordered: string[] = []
  const add = (key: string | null) => {
    if (key != null && !ordered.includes(key)) ordered.push(key)
  }
  for (const s of view.path) if (!remainingKeys.has(s.key)) add(s.key)
  add(currentKey)
  for (const k of view.remainingNodeKeys) add(k)

  return ordered
    .filter((key) => !questionKeys.has(key))
    .map((key, index) => {
      const def = defs.get(key)
      const isCurrent = !ended && key === currentKey
      // 방문 수 — path 는 서버가 지금 노드 자신을 뺀 목록이라 지금 노드와 같은 행만 1 을 더한다.
      // 질문 노드로 접힌 칸(지금은 dev_ask, 칸은 dev)은 cur.key 와 다르므로 path 에 dev 방문이 그대로 남아 더하지 않는다.
      const pathVisits = view.path.filter((s) => s.key === key).length
      const visits = pathVisits + (cur != null && cur.key === key ? 1 : 0)
      // 상태 — 방문 여부와 남은 단계 키로 갈린다(리뷰 ② · 남은 단계 키가 이긴다): 지금 → 방문(✓) → 남음. 완료라도 방문하지 않은 행은 ✓ 가 아니다 —
      // 끝난 실행은 지금 표식을 쓰지 않으므로(ended) 완료 행은 visits 로만 갈린다.
      // 다만 남은 단계에 다시 들어온 키(되돌린 실행)는 방문보다 남은 단계가 이긴다(리뷰 후속 ①) — 되돌아간 단계가 ✓ 로 남지 않는다.
      let state: WorkflowStepState
      if (isCurrent) state = 'current'
      else if (visits > 0 && !remainingKeys.has(key)) state = 'passed'
      else state = 'remaining'
      // 다시 들어온 단계 표식 — 지금은 'n번째', 지난은 'n번'(1 이하면 없음).
      let repeat: string | null = null
      if (visits > 1) repeat = state === 'current' ? `${visits}번째` : `${visits}번`
      const lastVisit = [...view.path].reverse().find((s) => s.key === key)
      // 끝 단계 판정 — 정의가 없으면(버전 404) 지금 노드의 type 으로 받는다 — 정의를 못 읽는 동안 완료 실행의
      // 끝 행이 도착 시각 없이 끝나지 않게(완료 기준 3 · 정의 이름 대체와 같은 자리).
      const isEnd = def?.type === 'end' || (def == null && key === currentKey && cur?.type === 'end')
      // 행위자 — 지금은 담당, 첫 줄은 시작자, 그 밖에는 마지막 방문의 actor.
      // 시작 행의 시작자는 항목이 항상 사람이라 이름만으로 만들면 kind 가 사라져 Bot 표식이 안 그려진다 —
      // 실행 상세의 startedBy.kind 를 그대로 실어 에이전트 시작자도 Bot 아이콘 하나로 보이게 한다(디자인 시스템 07 §7.2).
      let actors: WorkflowUser[] = []
      if (isCurrent && cur) actors = cur.assignees
      else if (index === 0)
        actors = opts?.start?.name
          ? [{ id: 0, username: '', name: opts.start.name, kind: opts.start.kind ?? undefined }]
          : []
      else if (lastVisit?.actor) actors = [lastVisit.actor]
      // 시간 — 지금은 머문 시간(elapsedLabel 결과 그대로), 첫 줄은 시작 시각, 끝 줄은 완료일 때만 도착 시각(KST),
      // 지난 줄은 그 방문의 걸린 시간, 남은 줄은 없다(취소 실행의 끝 줄은 도착하지 않았으므로 시각이 없다).
      let timeLabel: string | null = null
      if (isCurrent && cur?.enteredAt) timeLabel = elapsedLabel(cur.enteredAt, now)
      else if (index === 0) timeLabel = opts?.start?.at ? formatClockTimeCompact(opts.start.at) : null
      else if (isEnd && completed && view.endedAt) timeLabel = formatClockTimeCompact(view.endedAt)
      else if (lastVisit?.leftAt) timeLabel = durationLabel(lastVisit.enteredAt, lastVisit.leftAt)
      const questionWaiting = waiting && key === currentKey
      // 이름 — 정의의 name 이 먼저(정의 버전을 못 읽으면 없음), 그다음 지금 노드·마지막 방문의 실행 이름, 그것도 없으면 키(리뷰 ③) —
      // 정의를 못 읽는 동안에도 키만 보이지 않게 path·currentNode 에 이미 온 이름으로 떨어진다.
      const runName = (key === currentKey ? cur?.name : null) ?? lastVisit?.name ?? null
      return {
        key,
        name: def?.name ?? runName ?? key,
        state,
        visits,
        repeat,
        actors,
        timeLabel,
        questionWaiting,
        questionFirstLine: questionWaiting && cur ? questionFirstLine(pendingQuestion(view.context, cur.key)) : null,
        questionAnswered: qa.filter((e) => e?.askNode === key && e?.answer != null).length,
        isStart: index === 0,
        isEnd,
      }
    })
}