import { X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'

import { moveTargets, type NodeTabProps } from './drawerModel'
import { DrawerSection } from './DrawerShell'
import {
  connectOutcome, countContextRefs, nextOutcomeKey, type NodeDetail, parseMaxVisits, removeNode,
} from './graphYaml'
import { NODE_FIELDS, type PanelField } from './nodeFields'
import { workflowSelectClass } from './WorkflowVersions'

const OUTPUT_TYPES = ['string', 'url', 'number', 'boolean']

/** 결과·내놓을 값 표시 이름의 최대 글자 수 — 서버 워크플로우 스키마의 name 길이 한도(40)와 같다. */
const WORKFLOW_NAME_MAX = 40

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
        <Input
          aria-label={output.key + ' 표시 이름'}
          maxLength={WORKFLOW_NAME_MAX}
          placeholder="표시 이름"
          className="h-8 w-24 shrink-0"
          value={output.name ?? ''}
          disabled={readOnly}
          onChange={(event) => onChange({ ...output, key: validKey(keyDraft) ?? output.key, name: event.target.value })}
        />
        <Button type="button" variant="ghost" size="icon-sm" aria-label="값 지우기" disabled={readOnly} onClick={onRemove}>
          <X />
        </Button>
      </div>
      {keyError && <p id={errorId} role="alert" className="text-xs text-destructive">{keyError}</p>}
    </div>
  )
}

/**
 * 노드 서랍의 「결과·경로」 탭(WP-2091) — 결과 → 다음 노드·내놓을 값·되돌림 제한·노드 지우기.
 * 옛 노드 편집 패널의 같은 칸을 그대로 옮겼다. 칸마다 NODE_FIELDS 의 종류별 허용 칸만 그린다.
 */
export function NodePathsTab({ yaml, graph, nodeKey, detail, readOnly, onChange, patch, onClose }: NodeTabProps & {
  /** 노드를 지운 뒤 서랍을 닫는다 */
  onClose: () => void
}) {
  // 내놓을 값 줄을 자리(index)가 아닌 안정 id 로 그린다 — 줄을 지워도 다른 줄이 지운 줄의 입력 상태를 물려받지 않게
  const outputKeys = detail.outputs.map((o) => o.key)
  const [rowIds, setRowIds] = useState<RowIds>(() => ({ keys: outputKeys, ids: outputKeys.map((_, i) => i), next: outputKeys.length }))
  const sameKeys = rowIds.keys.length === outputKeys.length && rowIds.keys.every((k, i) => k === outputKeys[i])
  const rows = sameKeys ? rowIds : reconcileRowIds(rowIds, outputKeys)
  if (rows !== rowIds) setRowIds(rows)
  const fields = NODE_FIELDS[detail.type] ?? new Set<PanelField>()
  const targets = moveTargets(graph, nodeKey)
  const setOutputs = (outputs: NodeDetail['outputs']) => patch({ outputs })

  return (
    <>
    {fields.has('outcomes') && (
      <DrawerSection
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
            {/* 표시 이름 — 비우면 YAML 의 name 칸이 사라지고 기본 이름(또는 key)이 보인다 */}
            <Input
              aria-label={outcome.key + ' 표시 이름'}
              maxLength={WORKFLOW_NAME_MAX}
              placeholder="표시 이름"
              className="h-8 w-24 shrink-0"
              value={outcome.name ?? ''}
              disabled={readOnly}
              onChange={(event) => patch({
                outcomes: detail.outcomes.map((o) => (o.key === outcome.key ? { ...o, name: event.target.value } : o)),
              })}
            />
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
      </DrawerSection>
    )}
    {fields.has('outputs') && (
      <DrawerSection
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
      </DrawerSection>
    )}
    {fields.has('maxVisits') && (
      <DrawerSection title="되돌림 제한">
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
      </DrawerSection>
    )}
    {detail.type !== 'start' && (
      <div className="border-t p-3">
        <Button
          type="button" variant="outline" size="sm" className="text-destructive" disabled={readOnly}
          onClick={() => { onChange(removeNode(yaml, nodeKey)); onClose() }}
        >노드 지우기</Button>
      </div>
    )}
    </>
  )
}
