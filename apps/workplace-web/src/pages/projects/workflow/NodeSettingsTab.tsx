import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

import { askTarget, instructionPreview, instructionStats, moveTargets, type NodeTabProps } from './drawerModel'
import { DrawerSection, YamlFixButton } from './DrawerShell'
import { commonErrorTarget } from './graphLayout'
import { addAskPath, type NodeDetail, type NodePatch, type WorkflowGraph } from './graphYaml'
import { type InstructionEditorTarget, targetOf } from './instructionLock'
import { NODE_FIELDS, type PanelField } from './nodeFields'
import { workflowSelectClass } from './WorkflowVersions'

/**
 * 서랍에 컨트롤이 없어 YAML 에서만 고치는 칸의 안내 — 노드 종류별. 검사 결과(REF_NODE_UNKNOWN 등)가 이 칸을 가리켜도 「설정」 탭으로 열리므로
 * 여기서 YAML 보기로 넘어갈 길을 둔다(개요 서랍의 「YAML 에서 고치기」와 같은 이름).
 */
const YAML_ONLY_FIELDS: Record<string, string> = {
  start: '시작 조건과 시작 노드로 들어오는 연결, 정의되지 않은 노드로 가는 연결은 그래프에서 고치지 않습니다.',
  decision: '분기 조건(conditions)과 기본 도착(default)은 그래프에서 고치지 않습니다.',
  human_task: '일을 되돌려 보낼 노드(returnTo)는 그래프에서 고치지 않습니다.',
}

/**
 * 이 노드에 보일 「YAML 에서 고치는 칸」 안내 — 없으면 undefined.
 * human_task 는 returnTo 선이 실제로 있을 때만(없으면 YAML 에서 고칠 칸이 없다), start·decision 은 늘 보인다.
 */
function yamlNoteFor(type: string, graph: WorkflowGraph, nodeKey: string): string | undefined {
  if (type === 'human_task' && !graph.edges.some((e) => e.kind === 'returnTo' && e.from === nodeKey)) return undefined
  return YAML_ONLY_FIELDS[type]
}

/** 목록에서 item 을 on 이면 더하고 아니면 뺀 새 목록. */
function toggle(list: string[], item: string, on: boolean): string[] {
  return on ? [...list, item] : list.filter((x) => x !== item)
}

/** 막혔을 때 라디오 값 — 공통 목적지로·이 노드만 다른 곳으로·이동 없음. */
type OnErrorMode = 'common' | 'custom' | 'none'

/**
 * 막혔을 때(onError) 고르기(WP-2091). 쓰기는 onError.to 만 바꾸고 assignTo 등 다른 키는 남긴다(updateNode 의 onError 경로).
 * 「이 노드만 바꾸기」는 도착 노드를 고르기 전에는 YAML 에 쓸 값이 없어, 고른 라디오를 지역 상태(customPending)로 들고 있다 —
 * 그렇지 않으면 라디오를 눌러도 YAML 이 그대로라 선택이 원래 자리로 튀어 돌아간다.
 */
function OnErrorField({ graph, nodeKey, onError, readOnly, patch }: {
  graph: WorkflowGraph
  nodeKey: string
  onError: NodeDetail['onError']
  readOnly: boolean
  patch: (p: NodePatch) => void
}) {
  const id = useId()
  const [customPending, setCustomPending] = useState(false)
  // 저장된 도착 노드가 바뀌면(YAML 보기 등 바깥 편집, 또는 아래 선택 상자) 눌러 둔 「이 노드만 바꾸기」를 비운다 —
  // 그 뒤의 선택은 저장값을 따른다. 요소를 다시 만들지 않으려고 key 대신 렌더 중 상태 조정을 쓴다(선택 상자의 포커스 유지).
  const [seenTo, setSeenTo] = useState(onError?.to)
  if (seenTo !== onError?.to) {
    setSeenTo(onError?.to)
    setCustomPending(false)
  }
  // 여러 노드의 onError 가 모이는 공통 목적지 — 없으면 첫 라디오를 그리지 않는다
  const common = commonErrorTarget(graph)
  // 선택 노드 자신이 공통 목적지면 이 라디오는 자기 자신으로 보내게 되므로 그리지 않는다
  const commonNode = common === null || common === nodeKey ? undefined : graph.nodes.find((n) => n.key === common)
  // 공통 라디오가 숨는 때(commonNode 없음)는 저장값이 공통 목적지여도 'custom' — 골라진 라디오가 없어지지 않게 같은 규칙을 쓴다
  const saved: OnErrorMode = !onError ? 'none' : commonNode && onError.to === common ? 'common' : 'custom'
  const mode: OnErrorMode = customPending ? 'custom' : saved
  // 도착 노드 후보 — 자기 자신·가상·시작 노드는 뺀다(drawerModel.moveTargets)
  const targets = moveTargets(graph, nodeKey)
  const to = onError?.to ?? ''
  return (
    <>
      <RadioGroup
        aria-label="막혔을 때"
        value={mode}
        disabled={readOnly}
        onValueChange={(value) => {
          const next = value as OnErrorMode
          setCustomPending(next === 'custom')
          if (next === 'common' && common !== null) patch({ onError: common })
          if (next === 'none') patch({ onError: null })
        }}
      >
        {commonNode && (
          <div className="flex items-center gap-2">
            <RadioGroupItem id={id + '-common'} value="common" />
            <Label htmlFor={id + '-common'} className="text-sm font-normal">{`공통 규칙 「${commonNode.name ?? commonNode.key}」으로`}</Label>
          </div>
        )}
        <div className="flex items-center gap-2">
          <RadioGroupItem id={id + '-custom'} value="custom" />
          <Label htmlFor={id + '-custom'} className="text-sm font-normal">이 노드만 바꾸기</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem id={id + '-none'} value="none" />
          <Label htmlFor={id + '-none'} className="text-sm font-normal">이동 없음</Label>
        </div>
      </RadioGroup>
      {mode === 'custom' && (
        <select
          aria-label="막혔을 때 도착 노드"
          className={workflowSelectClass + ' w-full'}
          value={to}
          disabled={readOnly}
          onChange={(event) => patch({ onError: event.target.value })}
        >
          {/* 아직 고르지 않았거나 목록에 없는 키(사람이 YAML 에 쓴 낡은 값)도 지금 값으로 보인다 */}
          {!targets.some((t) => t.key === to) && <option value={to} disabled={to === ''}>{to || '선택'}</option>}
          {targets.map((t) => <option key={t.key} value={t.key}>{t.name ?? t.key}</option>)}
        </select>
      )}
    </>
  )
}

/**
 * 지시 요약(WP-2091) — 앞 3줄 미리 보기와 「n자 · 표 n · 제목 n」 통계. 긴 지시가 서랍을 다 차지하지 않게 접어 두고,
 * 「지시 편집 ⤢」(읽기 전용이면 「지시 보기 ⤢」)를 누르면 넓은 편집 창(WP-2092)을 연다 — 창은 서랍 밖(NodeInstructionEditor)에서 뜬다.
 */
function InstructionSummary({ text, readOnly, onOpen }: {
  text: string
  readOnly: boolean
  onOpen: () => void
}) {
  const stats = instructionStats(text)
  const preview = instructionPreview(text)
  return (
    <DrawerSection
      title="지시"
      action={
        <Button type="button" variant="ghost" size="sm" aria-haspopup="dialog" onClick={onOpen}>
          {readOnly ? '지시 보기 ⤢' : '지시 편집 ⤢'}
        </Button>
      }
    >
      {preview
        ? <p className="line-clamp-3 whitespace-pre-line text-xs">{preview}</p>
        : <p className="text-xs text-muted-foreground">지시가 없습니다</p>}
      <p className="text-xs text-muted-foreground">{`${stats.chars}자 · 표 ${stats.tables} · 제목 ${stats.headings}`}</p>
    </DrawerSection>
  )
}

/**
 * 노드 서랍의 「설정」 탭(WP-2091) — 이름·담당 역할·필요 환경·사람에게 묻기·막혔을 때·공통 지시·지시 요약 순.
 * 칸마다 NODE_FIELDS 의 종류별 허용 칸만 그린다(서버가 막는 칸을 쓰지 않게). start·end·decision 은 이름만.
 */
export function NodeSettingsTab({ yaml, graph, nodeKey, detail, readOnly, onChange, patch, onOpenYaml, onOpenInstructions }: NodeTabProps & {
  /** YAML 보기로 넘어간다 — 서랍에 컨트롤이 없는 칸(decision 조건·returnTo)의 「YAML 에서 고치기」 */
  onOpenYaml: () => void
  /** 지시 편집 창을 연다 — 창은 서랍 밖에서 뜬다(NodeInstructionEditor) */
  onOpenInstructions: (target: InstructionEditorTarget) => void
}) {
  const fields = NODE_FIELDS[detail.type] ?? new Set<PanelField>()
  const asked = fields.has('ask') ? askTarget(graph, nodeKey) : null
  const yamlNote = yamlNoteFor(detail.type, graph, nodeKey)
  return (
    <>
      <div className="px-3 pb-3">
        <Input
          aria-label="노드 이름"
          className="h-8"
          value={detail.name ?? ''}
          disabled={readOnly}
          onChange={(event) => patch({ name: event.target.value || null })}
        />
      </div>
      {fields.has('role') && (
        <DrawerSection title="담당 역할">
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
        </DrawerSection>
      )}
      {fields.has('requires') && (
        <DrawerSection title="필요 환경">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={detail.requires.includes('local-repo')}
              disabled={readOnly}
              onCheckedChange={(v) => patch({ requires: toggle(detail.requires, 'local-repo', v === true) })}
            />
            로컬 저장소
          </label>
        </DrawerSection>
      )}
      {fields.has('ask') && (
        <DrawerSection title="사람에게 묻기">
          {asked
            ? <p className="text-sm">{`묻는 곳: ${asked.name ?? asked.key}`}</p>
            : (
              <Button type="button" variant="outline" size="sm" disabled={readOnly} onClick={() => onChange(addAskPath(yaml, nodeKey))}>
                질문 경로 추가
              </Button>
            )}
        </DrawerSection>
      )}
      {fields.has('onError') && (
        <DrawerSection title="막혔을 때">
          <OnErrorField graph={graph} nodeKey={nodeKey} onError={detail.onError} readOnly={readOnly} patch={patch} />
        </DrawerSection>
      )}
      {fields.has('use') && (
        <DrawerSection title="공통 지시">
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
        </DrawerSection>
      )}
      {fields.has('instructions') && (
        <InstructionSummary
          text={detail.instructions ?? ''}
          readOnly={readOnly}
          onOpen={() => onOpenInstructions(targetOf(nodeKey, detail))}
        />
      )}
      {yamlNote && (
        <DrawerSection title="YAML 에서 고치는 칸">
          <p className="text-xs text-muted-foreground">{yamlNote}</p>
          <YamlFixButton onClick={onOpenYaml} />
        </DrawerSection>
      )}
    </>
  )
}
