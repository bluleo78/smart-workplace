// 작성창 서명 블록 노드(WP-1517) — 저장한 서명 HTML 을 원자 노드 하나(속성 html)로 본문 끝에 둔다.
// 작성창 스키마(StarterKit)는 span style·font 를 지워 Outlook 서명의 글꼴·색이 사라지므로, 서명을 본문 노드로 풀지 않고
// 원문 그대로 들고 다니며 격리 iframe(MailSignatureNodeView)으로 그린다. 그 자리에서 고치지 못하고(내용은 설정에서 고친다),
// 고르고 Backspace 를 누르거나 펜 단추(removeMailSignature)로 뺀다.
//
// 보안(내정 2): 임시저장 본문은 서버가 정리하지 않아 AI 가 만든 임시저장에 `<div data-mail-signature><img onerror=…>` 가 들 수 있다.
// 그래서 서명 HTML 은 앱 문서(브라우징 컨텍스트가 있는 문서)에 DOM 으로 붙지 않게 한다 —
// - renderHTML 은 비활성 문서(createHTMLDocument)에서 요소를 만들고, 본문 HTML 은 mailComposerHtml 이 같은 비활성 문서로 직렬화한다
//   (Tiptap getHTML 은 앱 문서의 조각에 붙여 직렬화해, 붙는 순간 <img> 가 받아지고 onerror 가 돈다).
// - 편집기 화면은 늘 노드뷰로 그린다. EditorContent 가 붙기 전에는 React 노드뷰를 만들 수 없어 ProseMirror 가 renderHTML 결과를
//   화면 DOM 에 넣으려 하므로, 그동안은 빈 자리표시를 준다.
import { type Editor, Node } from '@tiptap/core';
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { ReactNodeViewRenderer } from '@tiptap/react';

import { inertDocument } from '@/lib/htmlTextEditSource';
import { htmlToPlainText, SIGNATURE_ATTR } from '@/lib/mailSignature';

import { MailSignatureNodeView } from './MailSignatureNodeView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mailSignature: {
      /** 있던 서명을 모두 빼고 본문 끝에 빈 줄 하나 + 서명을 넣는다(appendSignature 와 같은 간격). */
      insertMailSignature: (html: string) => ReturnType;
      /** 서명을 모두 빼고, 서명 바로 앞 빈 줄 하나도 뺀다. */
      removeMailSignature: () => ReturnType;
    };
  }
}

/** 서명 노드 이름 — 문서를 훑어 서명 유무·서명 밖 본문을 가를 때 쓴다. */
const MAIL_SIGNATURE_NODE = 'mailSignature';

/**
 * 서명 html 별 계산값을 최근 몇 개만 둔다 — getHTML·getText 는 키 입력(onUpdate)마다 불리는데 서명 html 은 거의 바뀌지 않아,
 * 같은 서명을 매번 다시 파싱하지 않게 한다. 한 작성창의 서명은 보통 하나라 작게 둔다(오래된 것부터 버린다).
 */
const SIGNATURE_CACHE_LIMIT = 4;
const signatureTextCache = new Map<string, string>();
const signatureElementCache = new Map<string, HTMLElement>();

/** cache 에서 html 의 값을 찾고, 없으면 make 로 만들어 넣는다(상한을 넘으면 가장 먼저 넣은 것을 뺀다). */
function cachedBySignature<T>(cache: Map<string, T>, html: string, make: (html: string) => T): T {
  const hit = cache.get(html);
  if (hit !== undefined) return hit;
  const value = make(html);
  if (cache.size >= SIGNATURE_CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(html, value);
  return value;
}

/** 서명 블록 요소(비활성 문서) — 캐시해 두는 원본이다. 밖으로 낼 때는 늘 복제한다(문서에 붙으면 원본이 옮겨지므로). */
function makeSignatureElement(html: string): HTMLElement {
  const el = inertDocument().createElement('div');
  el.setAttribute(SIGNATURE_ATTR, '');
  el.innerHTML = html;
  return el;
}

/**
 * 작성창 본문 HTML — Tiptap getHTML 과 같은 직렬화를 비활성 문서에서 한다(서명 HTML 이 앱 문서에 붙지 않게, 파일 머리 주석).
 * 작성창은 getHTML 대신 이것을 쓴다.
 */
export function mailComposerHtml(editor: Editor): string {
  const doc = inertDocument();
  const fragment = DOMSerializer.fromSchema(editor.schema).serializeFragment(editor.state.doc.content, { document: doc });
  const container = doc.createElement('div');
  container.appendChild(fragment);
  return container.innerHTML;
}

/** 빈 문단(빈 줄)인가 — 서명 앞 간격. */
function isEmptyParagraph(node: PMNode | null | undefined): boolean {
  return node != null && node.type.name === 'paragraph' && node.content.size === 0;
}

/**
 * 맨 위 서명 노드를 모두 빼고, 서명마다 그 앞(다른 서명은 건너뛴) 빈 문단 하나를 함께 뺀다 — 서명을 복사해 붙여 둘이 된 본문도 한 번에 정리한다.
 * 빼고 나면 문서가 비는 경우(서명뿐인 본문)는 빈 문단 하나로 둔다(문서는 블록이 하나 이상 있어야 한다). 뺀 것이 있으면 true.
 */
function removeSignatures(tr: Transaction): boolean {
  const doc = tr.doc;
  const children: { node: PMNode; pos: number }[] = [];
  doc.forEach((node, pos) => children.push({ node, pos }));
  const drop = new Set<number>();
  children.forEach(({ node }, i) => {
    if (node.type.name !== MAIL_SIGNATURE_NODE) return;
    drop.add(i);
    let j = i - 1;
    while (j >= 0 && children[j].node.type.name === MAIL_SIGNATURE_NODE) j--;
    if (j >= 0 && isEmptyParagraph(children[j].node)) drop.add(j);
  });
  if (drop.size === 0) return false;
  if (drop.size === children.length) {
    tr.replaceWith(0, doc.content.size, doc.type.schema.nodes.paragraph.create());
    return true;
  }
  // 뒤에서부터 지워 앞 노드 위치가 밀리지 않게 한다.
  for (const i of [...drop].sort((a, b) => b - a)) {
    const { node, pos } = children[i];
    tr.delete(pos, pos + node.nodeSize);
  }
  return true;
}

/** 서명 원자 노드. 속성 html 은 서버가 정리한 서명 HTML(임시저장에서 다시 열면 그 본문 안의 것). */
export const MailSignature = Node.create({
  name: MAIL_SIGNATURE_NODE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      // 요소 속성으로 내지 않는다 — renderHTML 이 html 을 요소 안쪽에 그대로 넣는다.
      html: { default: '', rendered: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: `div[${SIGNATURE_ATTR}]`,
        // 문단(p) 등 다른 규칙보다 먼저 — 서명 블록 안의 글을 본문 노드로 풀지 않는다.
        priority: 100,
        getAttrs: (el) => ({ html: (el as HTMLElement).innerHTML }),
      },
    ];
  },

  renderHTML({ node }) {
    // getHTML·임시저장·발송이 원문 서명 HTML 을 그대로 내게, 비활성 문서의 요소 안쪽에 넣어 돌려준다(파일 머리 주석).
    // 같은 서명은 한 번만 파싱하고 그 복제본을 낸다(복제도 같은 비활성 문서의 요소다).
    const el = cachedBySignature(signatureElementCache, String(node.attrs.html ?? ''), makeSignatureElement);
    return el.cloneNode(true) as HTMLElement;
  },

  // 보내는 평문(bodyText)에도 서명 글자를 싣는다. 앞 줄과의 간격은 getText 의 블록 구분자가 넣는다.
  renderText({ node }) {
    return cachedBySignature(signatureTextCache, String(node.attrs.html ?? ''), htmlToPlainText);
  },

  addNodeView() {
    const react = ReactNodeViewRenderer(MailSignatureNodeView);
    return (props) => {
      // EditorContent 가 붙기 전(React 노드뷰를 못 만든다) — renderHTML 결과가 화면 DOM 에 들어가지 않게 빈 자리표시를 준다.
      // 붙으면 Tiptap 이 노드뷰를 다시 만들어 React 노드뷰로 바뀐다.
      if (!(props.editor as Editor & { contentComponent?: unknown }).contentComponent) {
        const dom = document.createElement('div');
        dom.contentEditable = 'false';
        return { dom };
      }
      return react(props);
    };
  },

  addCommands() {
    return {
      insertMailSignature:
        (html: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            removeSignatures(tr);
            const { paragraph } = tr.doc.type.schema.nodes;
            tr.insert(tr.doc.content.size, [paragraph.create(), this.type.create({ html })]);
          }
          return true;
        },
      removeMailSignature:
        () =>
        ({ tr, dispatch }) => {
          // 서명이 없으면 할 일이 없다(false) — 단추 판정은 hasSignature 로 하므로 실제로는 늘 있다.
          if (!tr.doc.content.content.some((n) => n.type.name === MAIL_SIGNATURE_NODE)) return false;
          if (dispatch) removeSignatures(tr);
          return true;
        },
    };
  },
});

/** 문서를 한 번 훑어 서명 유무와, 서명 밖 본문이 비었는지(글자도 이미지도 없음)를 낸다 — 작성창 onChange 의 info. */
export function mailBodyInfo(doc: PMNode): { hasSignature: boolean; bodyEmpty: boolean } {
  let hasSignature = false;
  let bodyEmpty = true;
  doc.descendants((node) => {
    if (node.type.name === MAIL_SIGNATURE_NODE) {
      hasSignature = true;
      return false;
    }
    if (node.type.name === 'image') bodyEmpty = false;
    else if (node.isText && (node.text ?? '').trim() !== '') bodyEmpty = false;
    return true;
  });
  return { hasSignature, bodyEmpty };
}
