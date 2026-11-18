// @vitest-environment jsdom
// 작성창 서명 노드 명령(WP-1517) — 펜 단추가 부르는 넣기·빼기가 서명 개수와 간격을 맞추는지 순수 에디터로 본다.
// 펜 단추 경로(화면)는 src/pages/mail/mailComposeSignature.test.tsx 가 다시 본다.
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, expect, test } from 'vitest';

import { appendSignature, signatureBlockHtml } from '@/lib/mailSignature';

import { mailBodyInfo, mailComposerHtml, MailSignature, selectUserContentEnd, userContentEndSelection } from './mailSignatureNode';

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

// WP-1746 — 「내가 쓴 본문의 끝」: 서명과 그 앞 간격 줄 하나를 건너뛴 자리. 이어 쓴 글이 서명 아래로 가지 않게.
test('본문 끝 선택은 서명과 간격 줄 위, 내가 쓴 마지막 글 끝이다', () => {
  const ed = make(appendSignature('<p>쓰다 만 답</p>', S));
  ed.commands.setTextSelection(userContentEndSelection(ed.state.doc).from);
  ed.commands.insertContent(' 이어서');
  expect(ed.getHTML()).toBe(appendSignature('<p>쓰다 만 답 이어서</p>', S));
});

test('서명이 없으면 문서 끝, 서명만 있는 빈 본문이면 첫 줄이다', () => {
  const plain = make('<p>첫째</p><p>둘째</p>');
  expect(userContentEndSelection(plain.state.doc).from).toBe(plain.state.doc.content.size - 1);
  plain.destroy();
  const empty = make(appendSignature('', S));
  expect(userContentEndSelection(empty.state.doc).from).toBe(1);
});

test('본문이 서명뿐이면 서명을 고르지 않고 서명 앞 새 줄에 커서를 둔다 — 첫 글자가 서명을 지우지 않는다', () => {
  // 간격 줄까지 지운 채 저장한 답장 임시보관함 — 서명 앞에 글자 자리가 없다.
  const ed = make(B);
  let inserted = false;
  ed.chain()
    .command(({ tr }) => {
      inserted = selectUserContentEnd(tr);
      return true;
    })
    .run();
  expect(inserted).toBe(true);
  expect(ed.state.selection.empty).toBe(true);
  ed.commands.insertContent('안녕');
  expect(ed.getHTML()).toBe('<p>안녕</p>' + B);
});

test('서명 앞에 글자 자리가 있으면 줄을 넣지 않고 그 자리를 고른다', () => {
  const ed = make(appendSignature('', S));
  const before = ed.getHTML();
  let inserted = true;
  ed.chain()
    .command(({ tr }) => {
      inserted = selectUserContentEnd(tr);
      return true;
    })
    .run();
  expect(inserted).toBe(false);
  expect(ed.getHTML()).toBe(before);
  expect(ed.state.selection.from).toBe(1);
});

test('사용자가 띄운 빈 줄은 간격 줄 하나만 빼고 남긴다', () => {
  const ed = make('<p>본문</p><p></p>' + appendSignature('', S).replace(/^<p><\/p>/, ''));
  // <p>본문</p><p></p><p></p>[서명] — 간격 줄 하나를 건너뛰면 사용자가 띄운 빈 줄(둘째 문단)에 선다.
  const sel = userContentEndSelection(ed.state.doc);
  expect(ed.state.doc.resolve(sel.from).index(0)).toBe(1);
});
