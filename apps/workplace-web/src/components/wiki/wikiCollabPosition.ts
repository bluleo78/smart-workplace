import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from 'y-prosemirror'
import * as Y from 'yjs'

/**
 * y-prosemirror 동기화 플러그인 상태 중 위치 변환에 필요한 부분 — 라이브러리가 내보내지 않는 내부 모양이라
 * 이 파일 한곳에서만 캐스팅한다(업그레이드 시 여기만 고치면 된다).
 */
export interface YSyncState {
  doc: Y.Doc
  type: Y.XmlFragment
  binding: { mapping: Parameters<typeof absolutePositionToRelativePosition>[2] } | null
}

/** 에디터 상태의 동기화 플러그인 상태. 플러그인이 없으면 undefined. */
export function ySyncOf(state: EditorState): YSyncState | undefined {
  return ySyncPluginKey.getState(state) as YSyncState | undefined
}

/**
 * 이 트랜잭션이 남의 변경을 반영한 것인지 — y-prosemirror 메타(ySyncPluginKey)의 isChangeOrigin(Yjs → PM 반영)이면서
 * 내 실행 취소·다시 실행(isUndoRedoOperation)이 아닐 때(판정 R10). 내 실행 취소도 같은 경로로 오지만 내 입력이다 —
 * 선택 위치로 스크롤하고, 접속자 커서의 활동 횟수(seq)도 올린다. 원격 판정은 이 한곳에서만 한다(WikiRemoteScrollAnchor·WikiPresenceCursors).
 */
export function isRemoteSync(meta: unknown): boolean {
  const m = meta as { isChangeOrigin?: boolean; isUndoRedoOperation?: boolean } | undefined
  return m?.isChangeOrigin === true && m.isUndoRedoOperation !== true
}

/**
 * 트랜잭션 단위 원격 판정 — 다른 플러그인의 appendTransaction(링크 자동 감지·표 보정 등)이 원격 반영 뒤에 덧붙인 트랜잭션도
 * 원래 트랜잭션(ProseMirror 가 'appendedTransaction' 메타로 단다)을 따라 원격으로 본다.
 */
export function isRemoteSyncTr(tr: Transaction): boolean {
  const root = tr.getMeta('appendedTransaction') as Transaction | undefined
  return isRemoteSync((root ?? tr).getMeta(ySyncPluginKey))
}

/** 위치를 문서 범위 [0, content.size] 안으로 자른다 — 풀어 낸 위치·매핑한 위치가 그사이 줄어든 문서를 넘지 않게. */
export function clampPos(pos: number, doc: PMNode): number {
  return Math.max(0, Math.min(pos, doc.content.size))
}

/** 절대 위치 → Yjs 상대 위치(y-prosemirror 기본: 오른쪽에 붙음). 바인딩이 없으면 null. */
export function toRelative(state: EditorState, pos: number): Y.RelativePosition | null {
  const ys = ySyncOf(state)
  return ys?.binding ? absolutePositionToRelativePosition(pos, ys.type, ys.binding.mapping) : null
}

/** Yjs 상대 위치 → 이 상태의 절대 위치(범위 보정 없음). 바인딩이 없거나 풀 수 없으면 null. */
export function resolveRelative(state: EditorState, rel: Y.RelativePosition): number | null {
  const ys = ySyncOf(state)
  return ys?.binding ? relativePositionToAbsolutePosition(ys.doc, ys.type, rel, ys.binding.mapping) : null
}

/**
 * 상대 위치 JSON(awareness 의 자기 신고 값) → 이 상태의 절대 위치(문서 범위로 자름). 모양이 틀렸거나 풀 수 없으면 null.
 * 원격 커서(WikiPresenceCursors)·✦ 표식(WikiAiMarkers)이 같이 쓴다.
 */
export function resolveJson(state: EditorState, json: unknown): number | null {
  try {
    const pos = resolveRelative(state, Y.createRelativePositionFromJSON(json))
    return pos == null ? null : clampPos(pos, state.doc)
  } catch {
    return null
  }
}

/**
 * 비동기 작업(AI 생성·이슈 만들기) 동안 문서 위치를 붙잡아 둔다(WP-287).
 *
 * 왜: 동시 편집에선 생성이 끝나기 전에 다른 사람이 위쪽에 글을 넣거나 지울 수 있어, 시작 때 잡은 숫자 위치(from/to)가
 * 엉뚱한 곳을 가리키거나 문서 끝을 넘어 RangeError 가 난다. Yjs 상대 위치로 바꿔 두면 원격 편집을 따라간다.
 * 동기화 플러그인이 없으면(예외 상황) 숫자 위치를 문서 크기로 잘라 쓴다.
 *
 * @returns 완료 시점의 에디터(재마운트됐을 수 있음)를 받아 현재 절대 위치를 돌려주는 함수.
 */
export function anchorPosition(editor: Editor, pos: number): (current: Editor) => number {
  const rel = toRelative(editor.state, pos)
  return (current) => {
    const size = current.state.doc.content.size
    if (rel == null) return Math.min(pos, size)
    return Math.min(resolveRelative(current.state, rel) ?? pos, size)
  }
}
