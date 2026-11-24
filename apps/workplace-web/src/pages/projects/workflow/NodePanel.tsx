import { GitBranch, Play, Square, User, X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { AiIcon } from '@/components/ai/AiIcon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

import {
  connectOutcome, countContextRefs, nextOutcomeKey, type NodeDetail, parseMaxVisits, readNodeDetail, removeNode, updateNode, type WorkflowGraph,
} from './graphYaml'
import { NODE_FIELDS, type PanelField } from './nodeFields'
import { workflowSelectClass } from './WorkflowVersions'

const OUTPUT_TYPES = ['string', 'url', 'number', 'boolean']

/** 목록에서 item 을 on 이면 더하고 아니면 뺀 새 목록. */
function toggle(list: string[], item: string, on: boolean): string[] {
  return on ? [...list, item] : list.filter((x) => x !== item)
}

/** 내놓을 값 줄의 안정 id 목록 — 키 목록이 바뀔 때 이어 쓴다. */
interface RowIds { keys: string[]; ids: number[]; next: number }

/**
 * 새 키 목록에 줄 id 를 다시 맞춘다. 같은 키는 같은 id, 같은 자리의 키가 새 목록에 없으면 이름이 바뀐 것으로 보고
 * 그 자리 id 를 잇는다(입력 중 포커스가 유지된다). 그 밖의 새 키는 새 id. 지운 줄의 id 는 버려져 그 줄이 사라진다.
 */
function reconcileRowIds(prev: RowIds, keys: string[]): RowIds {
  let next = prev.next
  const taken = new Set<number>()
  const ids: number[] = []
  keys.forEach((k, i) => {
    const same = prev.keys.indexOf(k)
    const renamed = prev.keys[i]
    let id: number
    if (same >= 0 && !taken.has(prev.ids[same])) id = prev.ids[same]
    else if (renamed !== undefined && !keys.includes(renamed) && !taken.has(prev.ids[i])) id = prev.ids[i]
    else id = next++
    taken.add(id)
    ids.push(id)
  })
  return { keys, ids, next }
}

/** 노드 종류별 머리 아이콘. 장식이라 스크린리더에서는 숨긴다. */
export function NodeKindIcon({ type, className }: { type: string; className?: string }) {
  const cls = className ?? 'size-4 shrink-0'
  if (type === 'agent_task') return <AiIcon className={cls} />
  if (type === 'human_task') return <User className={cls} aria-hidden="true" />
  if (type === 'start') return <Play className={cls} aria-hidden="true" />
  if (type === 'end') return <Square className={cls} aria-hidden="true" />
  return <GitBranch className={cls} aria-hidden="true" />
}

/** 절 하나 — 34px 소제목 줄과 본문. */
function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-t">
      <div className="flex h-[34px] items-center justify-between px-3">
        <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
        {action}
      </div>
      <div className="space-y-2 px-3 pb-3">{children}</div>
    </section>
  )
}

/** 내놓을 값 한 줄. 키는 입력 도중 비거나 겹칠 수 있어 지역 상태로 들고, 유효할 때만 YAML 에 쓴다. */
function OutputRow({ output, others, readOnly, onChange, onRemove }: {
  output: NodeDetail['outputs'][number]
  others: string[]
  readOnly: boolean
  onChange: (next: NodeDetail['outputs'][number]) => void
  onRemove: () => void
}) {
  const [keyDraft, setKeyDraft] = useState(output.key)
  // YAML 쪽 키가 바뀌면(다른 줄이 지워져 이 줄이 다른 값을 받는 등) 입력 중인 키도 그 값으로 다시 맞춘다.
  // 렌더 중 이전 값과 비교해 맞추는 React 권장 방식(effect 없이 한 번에 반영).
  const [syncedKey, setSyncedKey] = useState(output.key)
  if (syncedKey !== output.key) {
    setSyncedKey(output.key)
    setKeyDraft(output.key)
  }
  // 키를 쓸 수 없는 까닭(비었음·다른 줄과 겹침) — 없으면 null
  const keyProblem = (k: string) => (!k.trim() ? '키를 비울 수 없어 저장하지 않았습니다' : others.includes(k) ? '같은 키가 있어 저장하지 않았습니다' : null)
  // 입력 중인 키가 쓸 수 있으면 그 키, 아니면 YAML 의 키
  const validKey = (k: string) => (keyProblem(k) ? null : k)
  // 입력이 YAML 과 다를 때만 까닭을 줄 아래에 알린다 — 알림이 없으면 입력이 저장된 줄로 오해한다.
  // 읽기 전용이거나 문서에 원래 그렇게 적힌 키는 사람이 고친 것이 아니라 알리지 않는다
  const pending = !readOnly && keyDraft !== output.key
  const keyError = pending ? keyProblem(keyDraft) : null
  const errorId = useId()
  // 겹쳐서 못 쓴 키가 다른 줄이 바뀌어(이름 바꿈·지움) 쓸 수 있게 되면 그때 YAML 에 옮긴다 — 알림만 사라지고 입력이 저장되지 않은 채 남지 않게.
  // 옮기면 output.key 가 따라와 pending 이 풀리므로 한 번만 쓴다
  const commitKey = pending && !keyError ? keyDraft : null
  useEffect(() => {
    if (commitKey !== null) onChange({ ...output, key: commitKey })
  }, [commitKey, output, onChange])
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <Input
          aria-label="값 키"
          aria-invalid={keyError ? true : undefined}
          aria-describedby={keyError ? errorId : undefined}
          className="h-8 min-w-0 flex-1"
          value={keyDraft}
          disabled={readOnly}
          onChange={(event) => {
            const next = event.target.value
            setKeyDraft(next)
            if (validKey(next)) onChange({ ...output, key: next })
          }}
        />
        <select
          aria-label="값 종류"
          className={workflowSelectClass}
          value={output.type}
          disabled={readOnly}
          onChange={(event) => onChange({ ...output, key: validKey(keyDraft) ?? output.key, type: event.target.value })}
        >
          {OUTPUT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs">
          <Checkbox
            aria-label="필수"
            checked={output.required}
            disabled={readOnly}
            onCheckedChange={(v) => onChange({ ...output, required: v === true })}
          />
          필수
        </label>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="값 지우기" disabled={readOnly} onClick={onRemove}>
          <X />
        </Button>
      </div>
      {keyError && <p id={errorId} role="alert" className="text-xs text-destructive">{keyError}</p>}
    </div>
  )
}

/**
 * 고른 노드를 고치는 오른쪽 패널. 입력이 바뀔 때마다 updateNode 로 YAML 을 고쳐 onChange 로 올린다.
 * 상태를 따로 두지 않고 yaml 에서 매번 읽는다 — YAML 편집기와 한 원본을 공유하기 위해서다.
 * 부모는 key={노드 키} 로 그려 노드를 바꾸면 줄의 지역 상태(입력 중인 값 키)가 새로 시작되게 한다.
 */
export function NodePanel({ yaml, graph, nodeKey, readOnly, onChange, onClose }: {
  yaml: string
  /** 부모가 이미 파싱한 그래프 — 패널이 YAML 을 다시 파싱하지 않게 역할·공용 지시·노드 목록을 여기서 읽는다 */
  graph: WorkflowGraph
  nodeKey: string
  readOnly: boolean
  onChange: (yaml: string) => void
  onClose: () => void
}) {
  // yaml·노드가 같은 재렌더(선택·호버 등)에서는 다시 파싱하지 않는다
  const detail = useMemo(() => readNodeDetail(yaml, nodeKey), [yaml, nodeKey])
  // 내놓을 값 줄을 자리(index)가 아닌 안정 id 로 그린다 — 줄을 지워도 다른 줄이 지운 줄의 입력 상태를 물려받지 않게
  const currentKeys = detail?.outputs.map((o) => o.key) ?? []
  const [rowIds, setRowIds] = useState<RowIds>(() => ({ keys: currentKeys, ids: currentKeys.map((_, i) => i), next: currentKeys.length }))
  const sameKeys = rowIds.keys.length === currentKeys.length && rowIds.keys.every((k, i) => k === currentKeys[i])
  const rows = sameKeys ? rowIds : reconcileRowIds(rowIds, currentKeys)
  if (rows !== rowIds) setRowIds(rows)
  // 좁은 폭에서는 패널이 캔버스 아래로 쌓여 뷰포트 바깥(이슈 재현: y 855 / 뷰포트 844)에 열릴 수 있다 —
  // 그 자리에서는 아무 일도 안 일어난 것처럼 보여 노드를 누른 것이 티가 나지 않는다.
  // 패널이 열릴 때(nodeKey 바뀜 — 부모가 key 로 다시 그리므로 새로 마운트될 때마다) 머리 줄만 보이는 자리로 스크롤한다.
  //
  // - 머리 줄만 맞추는 까닭: 패널 전체를 맞추면 짧은 화면(390×664)에서는 nearest 가 패널 높이를 모두 끌어당려
  //   방금 누른 노드가 위로 밀려 사라진다. 머리 줄(아이콘·이름·닫기)이 보이면 그 자리에서 편집을 이어갈 수 있다.
  // - 세로로 쌓였거나 머리 줄이 뷰포트 밖일 때만 도는 까닭: 넓은 폭의 나란한 배치에서 마운트마다 페이지를
  //   내리면, 그래프가 화면 아래로 잘린 채 노드를 누를 때 노드가 커서 밑으로 밀려 움직인다(지적 1).
  const panelRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    // 머리 줄 — 패널의 첫 자식(노드 종류 아이콘·이름 입력·닫기 단추가 있는 줄)
    const head = panel.firstElementChild
    if (!(head instanceof HTMLElement)) return
    const headBox = head.getBoundingClientRect()
    const headOutside = headBox.top < 0 || headBox.bottom > window.innerHeight
    // 배치는 부모 flex 방향으로 본다 — @3xl 이상이면 캔버스 오른쪽(가로), 그 아래는 세로로 쌓임
    const parent = panel.parentElement
    const stacked = parent !== null && getComputedStyle(parent).flexDirection === 'column'
    if (!stacked && !headOutside) return
    head.scrollIntoView({ block: 'nearest' })
  }, [nodeKey])
  if (!detail) return null
  const patch = (p: Parameters<typeof updateNode>[2]) => onChange(updateNode(yaml, nodeKey, p))
  const fields = NODE_FIELDS[detail.type] ?? new Set<PanelField>()
  const targets = graph.nodes.filter((n) => !n.virtual && n.key !== nodeKey && n.type !== 'start')
  const outputKeys = detail.outputs.map((o) => o.key)
  const setOutputs = (outputs: NodeDetail['outputs']) => patch({ outputs })

  return (
    // 좁으면 폭 전체로 아래에 쌓이고(세로로 쌓일 때는 선이 패널 위쪽, 곧 캔버스 바로 아래에 놓이고 가로일 때는 왼쪽 경계가 된다), @3xl 이상에서만 지금처럼 캔버스 오른쪽 18rem — 판단 기준은 부모 @container(뷰포트 아님)
    // 세로로 쌓일 때는 높이를 60dvh 로 막아 overflow-y-auto 가 안쪽에서 돈다 — 막지 않으면 패널이 늘어날 때마다 페이지가 아래로 길어져 스크롤이 두 겹이 된다.
    // dvh 로 잰 까닭: 60vh 는 모바일 주소창이 늘어나는 동안 화면보다 커 패널 바닥이 잘릴 수 있다(주소창 높이를 안 반영하는 vh 는 짧은 화면 경계에서 어긋난다).
    <aside
      ref={panelRef}
      aria-label="노드 편집"
      className="flex max-h-[60dvh] w-full shrink-0 flex-col overflow-y-auto border-t bg-card text-sm @3xl:max-h-none @3xl:w-72 @3xl:border-t-0 @3xl:border-l"
    >
      <div className="flex items-center gap-2 p-3">
        <NodeKindIcon type={detail.type} />
        <Input
          aria-label="노드 이름"
          className="h-8 min-w-0 flex-1"
          value={detail.name ?? ''}
          disabled={readOnly}
          onChange={(event) => patch({ name: event.target.value || null })}
        />
        <Button type="button" variant="ghost" size="icon-sm" aria-label="패널 닫기" onClick={onClose}><X /></Button>
      </div>
      <code className="px-3 pb-2 text-xs text-muted-foreground">{detail.key}</code>
      {fields.has('role') && (
        <Section title="담당 역할">
          <select
            aria-label="담당 역할 선택"
            className={workflowSelectClass + ' w-full'}
            value={detail.role ?? ''}
            disabled={readOnly}
            onChange={(event) => patch({ role: event.target.value || null })}
          >
            <option value="">없음</option>
            {graph.roles.map((role) => <option key={role.key} value={role.key}>{role.name ?? role.key}</option>)}
          </select>
        </Section>
      )}
      {fields.has('requires') && (
        <Section title="필요한 능력">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={detail.requires.includes('local-repo')}
              disabled={readOnly}
              onCheckedChange={(v) => patch({ requires: toggle(detail.requires, 'local-repo', v === true) })}
            />
            로컬 저장소
          </label>
        </Section>
      )}
      {fields.has('instructions') && (
        <Section title="지시">
          <Textarea
            aria-label="지시 내용"
            rows={5}
            value={detail.instructions ?? ''}
            disabled={readOnly}
            onChange={(event) => patch({ instructions: event.target.value || null })}
          />
        </Section>
      )}
      {fields.has('use') && (
        <Section title="공통 지시">
          {graph.shared.length === 0 && <p className="text-xs text-muted-foreground">공유 지시가 없습니다</p>}
          {graph.shared.map((name) => (
            <label key={name} className="flex items-center gap-2">
              <Checkbox
                checked={detail.use.includes(name)}
                disabled={readOnly}
                onCheckedChange={(v) => patch({ use: toggle(detail.use, name, v === true) })}
              />
              {name}
            </label>
          ))}
        </Section>
      )}
      {fields.has('outcomes') && (
        <Section
          title="결과 → 다음 노드"
          action={
            <Button
              type="button" variant="ghost" size="sm" disabled={readOnly || targets.length === 0}
              onClick={() => onChange(connectOutcome(yaml, nodeKey, nextOutcomeKey(yaml, nodeKey), targets[0].key))}
            >+ 추가</Button>
          }
        >
          {detail.outcomes.map((outcome) => (
            <div key={outcome.key} className="flex items-center gap-1">
              <code className="w-20 shrink-0 truncate text-xs">{outcome.key}</code>
              <select
                aria-label={outcome.key + ' 도착 노드'}
                className={workflowSelectClass + ' min-w-0 flex-1'}
                value={outcome.to}
                disabled={readOnly}
                onChange={(event) => patch({
                  outcomes: detail.outcomes.map((o) => (o.key === outcome.key ? { ...o, to: event.target.value } : o)),
                })}
              >
                {!targets.some((t) => t.key === outcome.to) && <option value={outcome.to}>{outcome.to || '선택'}</option>}
                {targets.map((t) => <option key={t.key} value={t.key}>{t.name ?? t.key}</option>)}
              </select>
              <Button
                type="button" variant="ghost" size="icon-sm" aria-label={outcome.key + ' 결과 지우기'} disabled={readOnly}
                onClick={() => patch({ outcomes: detail.outcomes.filter((o) => o.key !== outcome.key) })}
              ><X /></Button>
            </div>
          ))}
        </Section>
      )}
      {fields.has('outputs') && (
        <Section
          title="내놓을 값"
          action={
            <Button
              type="button" variant="ghost" size="sm" disabled={readOnly}
              onClick={() => {
                let n = 1
                while (outputKeys.includes('value_' + n)) n++
                setOutputs([...detail.outputs, { key: 'value_' + n, type: 'string', required: false }])
              }}
            >+ 추가</Button>
          }
        >
          {detail.outputs.map((output, index) => (
            <OutputRow
              key={rows.ids[index]}
              output={output}
              others={outputKeys.filter((_, i) => i !== index)}
              readOnly={readOnly}
              onChange={(next) => setOutputs(detail.outputs.map((o, i) => (i === index ? next : o)))}
              onRemove={() => {
                // 이 값을 보던 분기 조건은 함께 지워진다(graphYaml.syncContextRefs) — 조용히 사라지지 않게 몇 개인지 알린다
                const refs = countContextRefs(yaml, nodeKey, output.key)
                setOutputs(detail.outputs.filter((_, i) => i !== index))
                if (refs > 0) toast.info(`「${output.key}」를 보던 분기 조건 ${refs}개도 함께 지웠습니다`)
              }}
            />
          ))}
        </Section>
      )}
      {fields.has('maxVisits') && (
        <Section title="되돌림 제한">
          <Input
            aria-label="되돌림 횟수"
            type="number"
            min={1}
            className="h-8"
            value={detail.maxVisits ?? ''}
            disabled={readOnly}
            onChange={(event) => {
              // 1 이상 정수만 쓴다 — 0·음수·소수는 서버가 거절하므로 YAML 에 옮기지 않는다
              // 입력 도중의 잘못된 값(예: '-', 'e')은 value 가 빈 문자열로 오므로 badInput 이면 지우지 않고 그대로 둔다
              if (event.target.value === '' && event.target.validity.badInput) return
              const maxVisits = parseMaxVisits(event.target.value)
              if (maxVisits !== undefined) patch({ maxVisits })
            }}
          />
        </Section>
      )}
      {detail.type !== 'start' && (
        <div className="border-t p-3">
          <Button
            type="button" variant="outline" size="sm" className="text-destructive" disabled={readOnly}
            onClick={() => { onChange(removeNode(yaml, nodeKey)); onClose() }}
          >노드 지우기</Button>
        </div>
      )}
    </aside>
  )
}
