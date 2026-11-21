import type { Editor } from '@tiptap/core';

/** 조합 대기가 취소됐음(cancel 호출·에디터 파괴)을 알리는 거절 사유. */
export class CompositionWaitCancelled extends Error {
  constructor() {
    super('composition wait cancelled');
  }
}

/** compositionend 뒤 기다리는 시간 — ProseMirror 가 compositionend 후 20ms 타이머(scheduleComposeEnd)로 조합을 마무리하므로 그보다 넉넉히. */
export const COMPOSITION_SETTLE_MS = 50;
/** compositionend 없이 조합이 풀렸을 때를 위한 점검 주기(Android 조합 타임아웃 등 ProseMirror 가 신호 없이 끝내는 경우). */
export const COMPOSITION_POLL_MS = 1000;

/**
 * 에디터의 한글 조합이 끝날 때까지 기다린다(WP-1923).
 * 조합 중에 문서를 지우면 조합이 끊기고 글자가 깨지므로, 호출처는 resolve 뒤에 현재 문서로 다시 판정해 지운다.
 * - 조합 중이 아니면 바로 resolve.
 * - 조합 중이면 compositionend 뒤 COMPOSITION_SETTLE_MS 가 지나도 조합 중이 아닐 때 resolve. 그 사이 다시 조합이
 *   시작되면(음절 경계의 compositionend→compositionstart) 다음 compositionend 를 기다린다.
 * - compositionend 가 오지 않아도 COMPOSITION_POLL_MS 마다 점검해 조합이 풀려 있으면 resolve(가드가 영영 안 풀리는 것 방지).
 * - cancel() 이나 에디터 파괴면 CompositionWaitCancelled 로 reject — 호출처는 지우지 않고 끝낸다.
 */
export function waitCompositionIdle(editor: Editor): { promise: Promise<void>; cancel: () => void } {
  if (editor.isDestroyed || !editor.view.composing) {
    return { promise: Promise.resolve(), cancel: () => {} };
  }
  const dom = editor.view.dom;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  let finish!: (ok: boolean) => void;
  const promise = new Promise<void>((resolve, reject) => {
    finish = (ok) => {
      if (done) return;
      done = true;
      dom.removeEventListener('compositionend', onEnd);
      editor.off('destroy', onDestroy);
      clearTimeout(settleTimer);
      clearInterval(pollTimer);
      if (ok) resolve();
      else reject(new CompositionWaitCancelled());
    };
  });
  // 조합 중이 아니면 끝낸다 — 파괴됐으면 취소.
  const checkIdle = () => {
    if (editor.isDestroyed) finish(false);
    else if (!editor.view.composing) finish(true);
  };
  const onEnd = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(checkIdle, COMPOSITION_SETTLE_MS);
  };
  const onDestroy = () => finish(false);
  dom.addEventListener('compositionend', onEnd);
  editor.on('destroy', onDestroy);
  // compositionend 가 오지 않는 경우의 안전망.
  const pollTimer = setInterval(checkIdle, COMPOSITION_POLL_MS);
  return { promise, cancel: () => finish(false) };
}
