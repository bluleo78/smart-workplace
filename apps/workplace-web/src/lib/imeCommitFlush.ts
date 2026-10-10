// 한글 조합을 끝내는 키(Enter 등)가 마지막 글자를 지우지 않게 하는 ProseMirror 플러그인(WP-333).
//
// macOS Chrome 은 마지막 글자를 조합하던 중 Enter 를 누르면 조합 Enter keydown(229) → 마지막 조합 글자 다시 쓰기(DOM 변경)
// → compositionend → 조합 아닌 Enter keydown(13) 을 한 태스크 안에서 잇달아 보낸다. ProseMirror 는 키를 처리하기 전에
// 밀린 DOM 변경을 반영하려고 forceFlush 를 부르지만, 그건 "반영이 예약된" 경우에만 동작한다 — 이 순간엔 MutationObserver
// 콜백(마이크로태스크)이 아직 돌지 않아 예약조차 없어서, 줄 나누기가 확정 글자를 읽기 전 문서로 실행되고 그 글자가 사라진다.
// (ProseMirror 는 같은 순서를 Safari 에서만 대비해 둔다 — inOrNearComposition.)
// 여기서는 조합 종료 직후의 키 입력이면 키 처리보다 먼저 밀린 변경을 직접 가져와(flush) 문서에 넣고, 처리는 평소대로 넘긴다.
// Enter 뿐 아니라 조합을 끝내는 다른 키(Tab·⌘B·⌘K 등)도 같은 순서로 오므로 키는 가리지 않는다 — 밀린 변경 반영은 어느 키에나 무해하다.
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

import { isImeComposing, isTrailingImeEnter } from '@/lib/imeKey';

/** prosemirror-view 의 공개되지 않은 내부 — 조합 종료 시각과 DOM 변경 관찰기. 버전이 바뀌어 없어지면 아무것도 하지 않는다. */
interface ViewInternals {
  input?: { compositionEndedAt?: number };
  domObserver?: { flush?: () => void };
}

/** 조합 종료 직후의 키 입력이면 밀린 DOM 변경을 먼저 문서에 반영한다. 키 처리 자체는 평소대로 넘긴다(항상 false). */
export function flushBeforeComposedKey(view: EditorView, event: KeyboardEvent): boolean {
  if (view.composing || isImeComposing(event)) return false;
  const internals = view as unknown as ViewInternals;
  const endedAt = internals.input?.compositionEndedAt;
  if (endedAt === undefined || !isTrailingImeEnter(event.timeStamp, endedAt)) return false;
  internals.domObserver?.flush?.();
  return false;
}

/**
 * Tiptap 확장 — 키 처리 전체(ProseMirror 의 forceFlush, editorProps·플러그인의 handleKeyDown, 키맵)보다 먼저 돌도록
 * handleKeyDown 이 아니라 handleDOMEvents.keydown 에 건다(이쪽이 ProseMirror 키 처리 앞에서 불린다). 노트 본문·메일·채팅 입력이 쓴다.
 */
export const ImeCommitFlush = Extension.create({
  name: 'imeCommitFlush',
  addProseMirrorPlugins() {
    return [new Plugin({ props: { handleDOMEvents: { keydown: flushBeforeComposedKey } } })];
  },
});
