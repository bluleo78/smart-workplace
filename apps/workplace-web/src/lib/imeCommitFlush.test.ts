// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// jsdom 은 navigator.vendor 가 "Apple Computer, Inc." 라 ProseMirror 가 Safari 로 보고 조합 직후 Enter 를 통째로 무시한다
// (Safari 전용 대비). 고치려는 건 Chrome 경로라, prosemirror-view 가 모듈을 읽기 전에 Chrome 으로 보이게 한다.
vi.hoisted(() => Object.defineProperty(navigator, 'vendor', { value: 'Google Inc.', configurable: true }));

import { keymap } from '@tiptap/pm/keymap';
import { schema } from '@tiptap/pm/schema-basic';
import { EditorState, Plugin, TextSelection } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';

import { flushBeforeComposedKey } from './imeCommitFlush';

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

/** "가나" 문단 끝에 커서를 둔 편집기 — key 키맵은 그 순간 문서에 보이는 글자를 기록만 한다. */
function mount(withFix: boolean, key = 'Enter') {
  const seen: string[] = [];
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('가나')])]);
  const plugins = [
    ...(withFix ? [new Plugin({ props: { handleDOMEvents: { keydown: flushBeforeComposedKey } } })] : []),
    keymap({ [key]: (state) => (seen.push(state.doc.textContent), true) }),
  ];
  const place = document.createElement('div');
  document.body.append(place);
  view = new EditorView(place, { state: EditorState.create({ doc, selection: TextSelection.create(doc, 3), plugins }) });
  return seen;
}

const keydown = (key: string, keyCode: number) =>
  view!.dom.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true }));

/**
 * macOS Chrome 순서를 한 태스크 안에서 재현 — 조합 시작 → 마지막 글자 "다" 를 DOM 에 씀(아직 ProseMirror 가 읽지 않음)
 * → compositionend → 곧바로 조합 아닌 keydown. 사이에 마이크로태스크가 돌지 않아 DOM 변경이 밀린 채로 남는다.
 */
function composeLastSyllableThen(key: string, keyCode: number) {
  const dom = view!.dom;
  dom.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
  (dom.querySelector('p')!.firstChild as Text).appendData('다');
  dom.dispatchEvent(new CompositionEvent('compositionend', { data: '다', bubbles: true }));
  keydown(key, keyCode);
}

describe('flushBeforeComposedKey — 조합 종료 직후 키 입력이 확정 글자를 읽고 처리되게 한다(WP-333)', () => {
  it.each([
    ['Enter', 13],
    ['Tab', 9],
  ])('%s 키맵이 돌 때 마지막 조합 글자가 이미 문서에 들어가 있다', (key, keyCode) => {
    const seen = mount(true, key);
    composeLastSyllableThen(key, keyCode);
    expect(seen).toEqual(['가나다']);
  });

  it('(대조) 플러그인이 없으면 Enter 가 확정 글자 없는 문서로 처리된다 — 이 차이가 글자가 사라지던 원인', () => {
    const seen = mount(false);
    composeLastSyllableThen('Enter', 13);
    expect(seen).toEqual(['가나']);
  });

  it('조합과 무관한 평소 Enter 는 건드리지 않고 그대로 처리된다', () => {
    const seen = mount(true);
    keydown('Enter', 13);
    expect(seen).toEqual(['가나']);
  });
});
