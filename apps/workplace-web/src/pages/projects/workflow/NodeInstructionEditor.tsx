// 노드 지시 넓은 편집 창(WP-2092)을 노드 서랍 밖(그래프 편집기)에서 띄우는 껍데기.
import { useMemo, useState } from 'react'

import { readNodeDetail, readShared, updateNode } from './graphYaml'
import { InstructionEditorDialog, type SharedInstruction } from './InstructionEditorDialog'
import { INSTRUCTION_LOCK_NOTICE, type InstructionEditorTarget, lockReason } from './instructionLock'

/**
 * 노드 지시 넓은 편집 창(WP-2092)을 노드 서랍 밖에서 띄우는 껍데기.
 * 서랍 안에 두면 창이 열린 사이 AI 패널이 노드 키를 바꾸거나 YAML 을 깨뜨릴 때 서랍과 함께 창·고치던 글이 말없이 사라졌다 —
 * 그래서 서랍보다 오래 사는 그래프 편집기(문법 오류 안내로 바뀌어도 남는 자리)가 이것을 든다.
 * 적용할 수 없으면(lockReason) 창은 그대로 두고 읽기 전용 + 안내로 바꾼다(원문 모드에서 글을 복사할 수 있다). 같은 노드가 돌아오면 다시 고칠 수 있다.
 */
export function NodeInstructionEditor({ yaml, syntaxError, target, readOnly, onChange, onClose }: {
  yaml: string
  /** YAML 에 문법 오류가 있다 — 노드를 못 찾는 까닭이 삭제가 아니라 잠깐의 문법 오류임을 안내한다 */
  syntaxError: boolean
  target: InstructionEditorTarget
  readOnly: boolean
  onChange: (yaml: string) => void
  onClose: () => void
}) {
  const detail = useMemo(() => readNodeDetail(yaml, target.nodeKey), [yaml, target.nodeKey])
  // 키는 이름 목록을 이은 문자열 — detail 은 YAML 을 다시 읽을 때마다 새 배열이라 배열 자체를 키로 두면 매번 다시 계산된다
  const useKey = detail ? detail.use.join('\n') : ''
  // 왼쪽 「함께 받는 공통 지시」 — 정의가 없으면 text null. 그래프(graph.shared)는 이름만 들고 본문이 없어 YAML 에서 읽는다
  const shared = useMemo((): SharedInstruction[] => {
    const defs = readShared(yaml)
    // 빈 문자열을 나누면 [''] 라 이름 없는 공통 지시가 하나 생기지 않게 빈 목록으로
    const names = useKey === '' ? [] : useKey.split('\n')
    return names.map((name): SharedInstruction => ({ name, text: defs.find((s) => s.name === name)?.text ?? null }))
  }, [yaml, useKey])
  // 창을 연 뒤 노드를 한 번이라도 못 찾았는가(lockReason 의 「다른 노드」 판정용). 렌더 중 상태 조정 — 사라진 그 렌더부터 반영한다
  const [lost, setLost] = useState(false)
  if (detail === null && !lost) setLost(true)
  const lock = lockReason({ syntaxError, detail, lost, target })
  // 적용할 수 있는 동안만 지금 노드 값을 쓰고, 아니면 연 때의 값 — 빈 글·다른 노드의 글로 바꾸면 「다른 곳에서 바뀜」으로 잘못 본다
  const live = lock === null ? detail : null
  return (
    <InstructionEditorDialog
      open
      onOpenChange={(next) => { if (!next) onClose() }}
      nodeName={live ? (live.name ?? target.nodeKey) : target.nodeName}
      nodeKey={target.nodeKey}
      text={live ? (live.instructions ?? '') : target.text}
      shared={shared}
      readOnly={readOnly || lock !== null}
      notice={lock === null ? null : INSTRUCTION_LOCK_NOTICE[lock]}
      onApply={(instructions) => onChange(updateNode(yaml, target.nodeKey, { instructions }))}
    />
  )
}
