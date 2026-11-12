// 서명 편집기(설정 › 메일 계정 「서명」 카드, WP-1517) Tiptap 확장 묶음.
// Outlook 서명을 붙여 넣으면 글꼴·색·로고 이미지·링크가 그대로 남아야 한다. 작성창(MailComposer)의 StarterKit 스키마는
// span style·font 를 지우므로, 여기서는 그 서식을 보존하는 mark(SignatureStyle)와 블록 style 속성(StyleAttribute)을 더한다.
// 정리(위험한 CSS·이벤트 속성 제거)와 이미지 저장은 서버 PUT 이 한다 — 편집기는 보존만 맡는다.
// 한계: Outlook <style> 블록의 클래스 서식(MsoNormal 등)은 Tiptap 이 클래스를 버려 사라진다(계획 Review Focus).
import { Extension, Mark, mergeAttributes } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import Underline from '@tiptap/extension-underline';
import { ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

import { MailLink } from '../mailEditorLink';
import { SignatureImageNodeView } from './SignatureImageNodeView';

/** HTML `<font size>`(1~7) → CSS 글자 크기 — 브라우저 기본 표(HTML 명세 「legacy font size」)와 같은 키워드. */
const FONT_SIZE_KEYWORDS: Record<string, string> = {
  '1': 'x-small',
  '2': 'small',
  '3': 'medium',
  '4': 'large',
  '5': 'x-large',
  '6': 'xx-large',
  '7': 'xxx-large',
};

/** 한 요소가 가진 글자 서식을 style 문자열로 — span 은 style 그대로, font 는 color·face·size 를 CSS 로 바꾼다. */
function ownStyle(el: Element): string {
  if (el.tagName === 'FONT') {
    const parts: string[] = [];
    const color = el.getAttribute('color');
    const face = el.getAttribute('face');
    const size = el.getAttribute('size');
    if (face) parts.push(`font-family: ${face}`);
    if (color) parts.push(`color: ${color}`);
    if (size && FONT_SIZE_KEYWORDS[size.trim()]) parts.push(`font-size: ${FONT_SIZE_KEYWORDS[size.trim()]}`);
    return parts.join('; ');
  }
  return el.getAttribute('style')?.trim() ?? '';
}

/** 서식 요소인가 — 이 mark 가 받는 태그. */
function isStyleElement(el: Element | null): el is Element {
  return el != null && (el.tagName === 'FONT' || (el.tagName === 'SPAN' && el.hasAttribute('style')));
}

/**
 * 바깥 서식 요소의 style 을 안쪽 것과 합친다(바깥 먼저, 안쪽이 뒤라 같은 속성은 안쪽이 이긴다).
 * 왜: 같은 mark 끼리는 서로 배제라 `<span style="font-family:…"><span style="color:…">` 처럼 겹친 서식에서 안쪽 mark 만 남는다.
 * Outlook 서명은 글꼴(바깥)·색(안쪽)을 이렇게 겹쳐 내므로, 안쪽 mark 에 바깥 서식을 미리 합쳐 둘 다 남긴다.
 */
function mergedStyle(el: Element): string {
  const chain: string[] = [];
  for (let cur: Element | null = el; isStyleElement(cur); cur = cur.parentElement) {
    const s = ownStyle(cur).replace(/;\s*$/, '');
    if (s) chain.unshift(s);
  }
  return chain.join('; ');
}

/** 글자 서식 mark — `span[style]`·`font` 를 style 문자열 하나로 들고 `<span style>` 로 낸다. */
export const SignatureStyle = Mark.create({
  name: 'signatureStyle',
  // 다른 mark(굵게·링크)와는 함께 쓰인다. 같은 mark 끼리는 기본대로 배제(합친 style 하나만 남는다).
  addAttributes() {
    return {
      style: {
        default: null,
        parseHTML: (el) => mergedStyle(el) || null,
        renderHTML: (attrs) => (attrs.style ? { style: attrs.style } : {}),
      },
    };
  },
  parseHTML() {
    return [
      { tag: 'span[style]', getAttrs: (el) => (mergedStyle(el as HTMLElement) ? null : false) },
      { tag: 'font', getAttrs: (el) => (mergedStyle(el as HTMLElement) ? null : false) },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },
});

/** 블록 style 속성 — 문단·제목·표·칸의 여백·정렬·테두리 서식을 남긴다(서명 표 배치). */
export const StyleAttribute = Extension.create({
  name: 'signatureBlockStyle',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'table', 'tableCell', 'tableHeader'],
        attributes: {
          style: {
            default: null,
            parseHTML: (el) => el.getAttribute('style')?.trim() || null,
            renderHTML: (attrs) => (attrs.style ? { style: attrs.style } : {}),
          },
        },
      },
    ];
  },
});

/** 문자열 속성 하나 — 있으면 그대로 내고 없으면 생략한다. */
function plainAttr(name: string) {
  return {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute(name),
    renderHTML: (attrs: Record<string, unknown>) => (attrs[name] ? { [name]: attrs[name] } : {}),
  };
}

/**
 * 서명 이미지 — 글 줄 안(inline)에 놓이고 width·height·style 을 남긴다.
 * src 는 거르지 않는다: data:·외부 http(s)·서명 이미지 경로는 서버가 받아 저장하고, 받을 수 없는 것(file:·blob:·cid:)은
 * 서버가 빼고 droppedImageCount 로 알려 준다 — 편집기가 미리 버리면 사용자가 빠진 줄 모른다. 노드뷰가 그릴 수 없는 것은 「불러올 수 없음」으로 보인다.
 */
export const SignatureImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: plainAttr('width'),
      height: plainAttr('height'),
      style: plainAttr('style'),
    };
  },
  parseHTML() {
    return [{ tag: 'img[src]', getAttrs: (el) => ((el as HTMLElement).getAttribute('src')?.trim() ? null : false) }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(SignatureImageNodeView);
  },
}).configure({ inline: true, allowBase64: true });

/** 서명 편집기 확장 — 작성창과 같은 기본 서식(StarterKit·링크)에 밑줄·표·서식 보존·이미지를 더한다. */
export const signatureEditorExtensions = [
  StarterKit,
  Underline,
  // Outlook 서명의 「www.company.com」→긴 https 주소 링크를 그대로 남기는 링크(WP-1517, mailEditorLink 의 MailLink).
  MailLink,
  SignatureStyle,
  StyleAttribute,
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  SignatureImage,
];
