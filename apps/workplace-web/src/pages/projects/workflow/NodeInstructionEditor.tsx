// 노드 지시 넓은 편집 창(WP-2092)을 노드 서랍 밖(그래프 편집기)에서 띄우는 껍데기.
import { useMemo, useState } from 'react'

import { readNodeDetail, readShared, updateNode } from './graphYaml'
import { InstructionEditorDialog, type SharedInstruction } from './InstructionEditorDialog'
import { INSTRUCTION_LOCK_NOTICE, type InstructionEditorTarget, type TargetTrack, trackTarget } from './instructionLock'

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
  // 잠김 추적(trackTarget) — 마지막으로 본 노드(연 때의 값에서 시작)와 「사라진 적 있음」. 잠긴 동안엔 last 로 창 제목·기준 글·공통 지시 목록을
  // 그린다(빈 글·다른 노드의 글로 바꾸면 「다른 곳에서 바뀜」으로 잘못 본다). 렌더 중 상태 조정 — 바뀐 렌더부터 반영하고, 같으면 멈춘다
  const [track, setTrack] = useState<TargetTrack>({ last: target, lost: false })
  const { last, lost, lock } = trackTarget(track, { detail, syntaxError })
  if (last !== track.last || lost !== track.lost) setTrack({ last, lost })
  const { useKey } = last
  // 왼쪽 「함께 받는 공통 지시」 — 정의가 없으면 text null. 그래프(graph.shared)는 이름만 들고 본문이 없어 YAML 에서 읽는다
  const shared = useMemo((): SharedInstruction[] => {
    const defs = readShared(yaml)
    // 빈 문자열을 나누면 [''] 라 이름 없는 공통 지시가 하나 생기지 않게 빈 목록으로
    const names = useKey === '' ? [] : useKey.split('\n')
    return names.map((name): SharedInstruction => ({ name, text: defs.find((s) => s.name === name)?.text ?? null }))
  }, [yaml, useKey])
  return (
    <InstructionEditorDialog
      open
      onOpenChange={(next) => { if (!next) onClose() }}
      nodeName={last.nodeName}
      nodeKey={target.nodeKey}
      text={last.text}
      shared={shared}
      readOnly={readOnly || lock !== null}
      notice={lock === null ? null : INSTRUCTION_LOCK_NOTICE[lock]}
      onApply={(instructions) => onChange(updateNode(yaml, target.nodeKey, { instructions }))}
    />
  )
}
