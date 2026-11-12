// @vitest-environment jsdom
// 메일 편집기 링크 보존(WP-1517) — 붙여 넣은 기존 <a> 의 href 가 Tiptap Link 의 붙여넣기 자동 링크에 덮이지 않는지 본다.
// Outlook 서명은 「www.company.com」 글자에 더 긴 https 주소를 거는 일이 흔하다 — 글자가 주소처럼 보여도 원래 href 를 지켜야 한다.
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, expect, test } from 'vitest';

import { MailLink } from './mailEditorLink';
import { signatureEditorExtensions } from './signature/signatureEditorExtensions';

// jsdom 에는 ClipboardEvent 가 없다 — ProseMirror pasteHTML/pasteText 가 만드는 붙여넣기 이벤트만 흉내 낸다(clipboardData 없음).
if (typeof globalThis.ClipboardEvent === 'undefined') {
  class FakeClipboardEvent extends Event {
    clipboardData: DataTransfer | null = null;
  }
  globalThis.ClipboardEvent = FakeClipboardEvent as unknown as typeof ClipboardEvent;
}

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function signatureEditor(): Editor {
  editor = new Editor({ extensions: signatureEditorExtensions });
  return editor;
}

function composerEditor(): Editor {
  editor = new Editor({ extensions: [StarterKit, MailLink] });
  return editor;
}

const SIG_ANCHOR = '<a href="https://example.com/sig">example.com</a>';

test('서명 편집기 — 주소처럼 보이는 글자의 링크를 붙여 넣어도 원래 href(https·경로)가 남는다', () => {
  const ed = signatureEditor();
  ed.view.pasteHTML(`<p>${SIG_ANCHOR}</p>`);
  expect(ed.getHTML()).toContain('href="https://example.com/sig"');
});

test('서명 편집기 — 선택 영역 위에 붙여 넣어도 원래 href 가 남는다', () => {
  const ed = signatureEditor();
  ed.commands.setContent('<p>옛 서명</p>');
  ed.commands.selectAll();
  ed.view.pasteHTML(`<p>${SIG_ANCHOR}</p>`);
  expect(ed.getHTML()).toContain('href="https://example.com/sig"');
  expect(ed.getHTML()).not.toContain('href="http://example.com"');
});

test('작성창 — 붙여 넣은 기존 링크의 href 는 그대로, 링크 없는 주소 글자는 여전히 자동 링크가 된다', () => {
  const ed = composerEditor();
  ed.view.pasteHTML(`<p>${SIG_ANCHOR} 그리고 https://plain.example.org/a</p>`);
  const html = ed.getHTML();
  expect(html).toContain('href="https://example.com/sig"');
  expect(html).not.toContain('href="http://example.com"');
  expect(html).toContain('href="https://plain.example.org/a"');
});

test('작성창 — 선택 영역 위에 링크를 붙여 넣으면 원래 href 가 남는다', () => {
  const ed = composerEditor();
  ed.commands.setContent('<p>본문</p>');
  ed.commands.selectAll();
  ed.view.pasteHTML(`<p>${SIG_ANCHOR}</p>`);
  expect(ed.getHTML()).toContain('href="https://example.com/sig"');
});

test('작성창 — 선택 영역 위에 링크 없는 주소 글자를 붙여 넣으면 선택한 글자에 그 주소가 걸린다(기존 동작)', () => {
  const ed = composerEditor();
  ed.commands.setContent('<p>본문</p>');
  ed.commands.selectAll();
  ed.view.pasteText('https://plain.example.org/a');
  expect(ed.getHTML()).toContain('href="https://plain.example.org/a"');
});

test('작성창 — 본문(인용·임시저장)에 이미 있는 링크 뒤에서 공백을 쳐도 href 가 바뀌지 않는다(입력 자동 링크는 기존 링크를 건너뜀)', () => {
  const ed = composerEditor();
  ed.commands.setContent(`<p>${SIG_ANCHOR}</p>`);
  ed.commands.focus('end');
  ed.commands.insertContent(' ');
  expect(ed.getHTML()).toContain('href="https://example.com/sig"');
  expect(ed.getHTML()).not.toContain('href="http://example.com"');
});
