// @vitest-environment jsdom
// 작성창 서명 노드 명령(WP-1517) — 펜 단추가 부르는 넣기·빼기가 서명 개수와 간격을 맞추는지 순수 에디터로 본다.
// 펜 단추 경로(화면)는 src/pages/mail/mailComposeSignature.test.tsx 가 다시 본다.
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, expect, test } from 'vitest';

import { appendSignature, signatureBlockHtml } from '@/lib/mailSignature';

import { mailBodyInfo, mailComposerHtml, MailSignature } from './mailSignatureNode';

const S = '<p style="color:#1F4E79">홍길동</p>';
const B = signatureBlockHtml(S);

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function make(content: string): Editor {
  editor = new Editor({ extensions: [StarterKit, MailSignature], content });
  return editor;
}

test('서명 블록은 원문 HTML(글꼴·색 style)을 그대로 다시 낸다 — 비활성 문서 직렬화도 getHTML 과 같다', () => {
  const ed = make(appendSignature('<p>안녕</p>', S));
  expect(ed.getHTML()).toBe(appendSignature('<p>안녕</p>', S));
  expect(mailComposerHtml(ed)).toBe(ed.getHTML());
});

test('서명이_둘이면_빼기는_모두_뺀다', () => {
  const ed = make('<p>안녕</p><p></p>' + B + B);
  ed.commands.removeMailSignature();
  expect(ed.getHTML()).toBe('<p>안녕</p>');
});

test('넣기는_하나만_넣고_간격을_맞춘다', () => {
  const ed = make('<p>안녕</p>');
  ed.commands.insertMailSignature(S);
  ed.commands.insertMailSignature(S);
  expect(ed.getHTML()).toBe(appendSignature('<p>안녕</p>', S));
});

test('빈 본문에 넣으면 쓸 줄 + 빈 줄 + 서명, 빼면 빈 본문으로 돌아간다', () => {
  const ed = make('');
  ed.commands.insertMailSignature(S);
  expect(ed.getHTML()).toBe(appendSignature('', S));
  ed.commands.removeMailSignature();
  expect(ed.getHTML()).toBe('<p></p>');
});

test('서명뿐인 본문(가짜 임시저장)도 빼면 빈 문단 하나가 남는다', () => {
  const ed = make(B);
  ed.commands.removeMailSignature();
  expect(ed.getHTML()).toBe('<p></p>');
});

test('평문(getText)에 서명 글자가 실린다', () => {
  const ed = make(appendSignature('<p>안녕</p>', '<p>홍길동</p><p>팀장</p>'));
  expect(ed.getText()).toMatch(/^안녕\n+홍길동\n팀장$/);
});

test('mailBodyInfo — 서명 유무와 서명 밖 본문이 비었는지', () => {
  expect(mailBodyInfo(make(appendSignature('', S)).state.doc)).toEqual({ hasSignature: true, bodyEmpty: true });
  editor?.destroy();
  expect(mailBodyInfo(make(appendSignature('<p>안녕</p>', S)).state.doc)).toEqual({ hasSignature: true, bodyEmpty: false });
  editor?.destroy();
  expect(mailBodyInfo(make('<p> </p>').state.doc)).toEqual({ hasSignature: false, bodyEmpty: true });
});
