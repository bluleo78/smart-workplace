// 서식 입력창(WP-101) 문서 ↔ 채팅 마크다운 본문. 에디터/DOM 비의존 순수 함수.
// 본문 → 문서는 렌더러와 같은 파서(chatMarkdown)를 쓰고, 문서 → 본문은 그 파서가 같은 문서로 다시 읽는 모양으로만 쓴다(왕복 보장).
// 글자는 이스케이프하지 않는다 — `a_b`·`1.`·URL 이 친 그대로 저장되도록(대신 평문으로 친 `**a**` 는 굵게로 보인다).
import type { JSONContent } from '@tiptap/core';
import type { PhrasingContent, RootContent } from 'mdast';

import { blankLinesBetween, isBareLink, MENTION_TOKEN, parseChatMarkdown } from './chatMarkdown';
import type { MentionUser } from './types';

type Mark = { type: string; attrs?: Record<string, unknown> };

// ── 본문 → 문서 ─────────────────────────────────────────────────────────────

/** 채팅 마크다운 본문 → TipTap 문서. 루트 줄은 줄마다 문단(기존 bodyToDoc 과 같다), 목록 항목 안 줄바꿈은 hardBreak. */
export function chatMarkdownToDoc(body: string, mentions: MentionUser[]): JSONContent {
  const nameById = new Map(mentions.map((m) => [m.id, m.name]));
  const { tree } = parseChatMarkdown(body);
  const content: JSONContent[] = [];
  let prev: RootContent | undefined;
  for (const b of tree.children) {
    for (let i = blankLinesBetween(prev, b); i > 0; i--) content.push({ type: 'paragraph' });
    content.push(...blockToNodes(b, nameById, true));
    prev = b;
  }
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
}

function blockToNodes(b: RootContent, names: Map<number, string>, root: boolean): JSONContent[] {
  if (b.type === 'paragraph') {
    const inline = phrasingToInline(b.children, [], names);
    if (!root) return [paragraph(inline.map((n) => (n.type === 'text' && n.text === '\n' ? { type: 'hardBreak' } : n)))];
    // 루트: 줄마다 문단.
    const lines: JSONContent[][] = [[]];
    for (const n of inline) {
      if (n.type === 'text' && n.text === '\n') lines.push([]);
      else lines[lines.length - 1].push(n);
    }
    return lines.map(paragraph);
  }
  if (b.type === 'list') {
    return [
      {
        type: b.ordered ? 'orderedList' : 'bulletList',
        ...(b.ordered ? { attrs: { start: b.start ?? 1 } } : {}),
        content: b.children.map((item) => {
          const inner = item.children.flatMap((c) => blockToNodes(c as RootContent, names, false));
          // 항목은 문단으로 시작해야 한다(스키마 paragraph block*).
          if (inner[0]?.type !== 'paragraph') inner.unshift({ type: 'paragraph' });
          return { type: 'listItem', content: inner };
        }),
      },
    ];
  }
  if (b.type === 'code') {
    return [{ type: 'codeBlock', ...(b.value ? { content: [{ type: 'text', text: b.value }] } : {}) }];
  }
  return [];
}

function paragraph(inline: JSONContent[]): JSONContent {
  const merged = mergeText(inline);
  return merged.length > 0 ? { type: 'paragraph', content: merged } : { type: 'paragraph' };
}

/** 마크가 같은 이웃 text 노드를 하나로 — 파서가 조각낸 글(들여쓰기·멘션 경계)을 에디터가 만드는 모양과 같게. */
function mergeText(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const n of nodes) {
    const last = out.at(-1);
    if (last?.type === 'text' && n.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(n.marks ?? [])) {
      out[out.length - 1] = { ...last, text: (last.text ?? '') + (n.text ?? '') };
    } else out.push(n);
  }
  return out;
}

/** 인라인 마크다운 → TipTap 인라인 노드. 줄바꿈은 '\n' 한 글자짜리 text 노드로 따로 떼어 둔다(호출처가 문단/hardBreak 로). */
function phrasingToInline(nodes: PhrasingContent[], marks: Mark[], names: Map<number, string>): JSONContent[] {
  const out: JSONContent[] = [];
  const withMarks = (n: JSONContent): JSONContent => (marks.length > 0 ? { ...n, marks } : n);
  for (const n of nodes) {
    switch (n.type) {
      case 'text': {
        // 줄 단위로 나누고, 줄 안은 멘션 토큰으로 나눈다.
        n.value.split('\n').forEach((line, li) => {
          if (li > 0) out.push({ type: 'text', text: '\n' });
          let last = 0;
          for (const m of line.matchAll(MENTION_TOKEN)) {
            if (m.index > last) out.push(withMarks({ type: 'text', text: line.slice(last, m.index) }));
            const id = Number(m[1]);
            out.push(withMarks({ type: 'mention', attrs: { id, label: names.get(id) ?? '알 수 없음' } }));
            last = m.index + m[0].length;
          }
          if (last < line.length) out.push(withMarks({ type: 'text', text: line.slice(last) }));
        });
        break;
      }
      case 'break':
        out.push({ type: 'text', text: '\n' });
        break;
      case 'inlineCode':
        // 코드 마크는 다른 마크와 함께 둘 수 없다(TipTap Code excludes '_').
        if (n.value) out.push({ type: 'text', text: n.value, marks: [{ type: 'code' }] });
        break;
      case 'strong':
        out.push(...phrasingToInline(n.children, [...marks, { type: 'bold' }], names));
        break;
      case 'emphasis':
        out.push(...phrasingToInline(n.children, [...marks, { type: 'italic' }], names));
        break;
      case 'delete':
        out.push(...phrasingToInline(n.children, [...marks, { type: 'strike' }], names));
        break;
      case 'chatUnderline':
        out.push(...phrasingToInline(n.children, [...marks, { type: 'underline' }], names));
        break;
      case 'link':
        out.push(...phrasingToInline(n.children, [...marks, { type: 'link', attrs: { href: n.url } }], names));
        break;
      default:
        break;
    }
  }
  return out;
}

// ── 문서 → 본문 ─────────────────────────────────────────────────────────────

/** 서식 노드·마크가 있는 문서인가 — 없으면 기존 평문 직렬화를 그대로 쓴다(코멘트 등 다른 입력창과 바이트 단위로 같게). */
export function hasChatFormatting(doc: JSONContent): boolean {
  const walk = (n: JSONContent): boolean =>
    (n.marks?.length ?? 0) > 0 ||
    n.type === 'bulletList' ||
    n.type === 'orderedList' ||
    n.type === 'codeBlock' ||
    (n.content ?? []).some(walk);
  return walk(doc);
}

const isList = (n: JSONContent) => n.type === 'bulletList' || n.type === 'orderedList';

/** TipTap 문서 → 채팅 마크다운 본문. */
export function serializeChatMarkdown(doc: JSONContent): string {
  return blocksToMd(doc.content ?? [], true);
}

/** 블록 잇기. 루트에서 목록 앞뒤는 빈 줄로 띄운다 — 없으면 다음 문단이 마지막 항목에 이어 붙고, 1 이 아닌 번호 목록은 문단을 끊지 못한다. */
function blocksToMd(blocks: JSONContent[], root: boolean): string {
  let out = '';
  blocks.forEach((b, i) => {
    if (i > 0) out += root && (isList(b) || isList(blocks[i - 1])) ? '\n\n' : '\n';
    out += blockToMd(b);
  });
  return out;
}

function blockToMd(b: JSONContent): string {
  if (isList(b)) {
    const start = Number(b.attrs?.start ?? 1);
    return (b.content ?? [])
      .map((item, i) => {
        const marker = b.type === 'orderedList' ? `${start + i}. ` : '- ';
        const pad = ' '.repeat(marker.length);
        const lines = blocksToMd(item.content ?? [], false).split('\n');
        return [marker + lines[0], ...lines.slice(1).map((l) => (l === '' ? '' : pad + l))].join('\n');
      })
      .join('\n');
  }
  if (b.type === 'codeBlock') {
    const text = (b.content ?? []).map((n) => n.text ?? '').join('');
    // 내용에 ``` 가 있으면 더 긴 펜스로 감싼다.
    const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return `${fence}\n${text}\n${fence}`;
  }
  return inlineToMd(b.content ?? []);
}

/** 마크를 연 순서대로 닫는 쪽 기호. */
function openMark(m: Mark): string {
  switch (m.type) {
    case 'bold':
      return '**';
    case 'italic':
      return '*';
    case 'strike':
      return '~~';
    case 'underline':
      return '<u>';
    case 'link':
      return '[';
    default:
      return '';
  }
}

function closeMark(m: Mark): string {
  switch (m.type) {
    case 'bold':
      return '**';
    case 'italic':
      return '*';
    case 'strike':
      return '~~';
    case 'underline':
      return '</u>';
    case 'link': {
      const href = String(m.attrs?.href ?? '');
      return `](${/[\s()<>]/.test(href) ? `<${href}>` : href})`;
    }
    default:
      return '';
  }
}

const sameMark = (a: Mark, b: Mark) => a.type === b.type && (a.type !== 'link' || a.attrs?.href === b.attrs?.href);

/** 인라인 조각 — 글(text) 하나와 그 마크. 멘션은 토큰 글로, hardBreak 는 마크 없는 '\n'. */
interface Seg {
  text: string;
  marks: Mark[];
  code: boolean;
}

function toSegs(nodes: JSONContent[]): Seg[] {
  const segs: Seg[] = [];
  for (const n of nodes) {
    const marks = ((n.marks ?? []) as Mark[]).filter((m) => m.type !== 'code');
    const code = (n.marks ?? []).some((m) => m.type === 'code');
    if (n.type === 'mention') segs.push({ text: `<@${n.attrs?.id}>`, marks, code: false });
    else if (n.type === 'hardBreak') segs.push({ text: '\n', marks: [], code: false });
    else if (n.type === 'text' && n.text) {
      if (code) {
        segs.push({ text: n.text, marks, code });
        continue;
      }
      // 마크 안쪽 앞뒤 공백은 밖으로 — `** a**` 는 굵게로 읽히지 않는다. 공백 조각은 이웃과 공통인 마크만 갖게 아래에서 다듬는다.
      const m = /^(\s*)(.*?)(\s*)$/s.exec(n.text)!;
      if (m[1]) segs.push({ text: m[1], marks, code: false });
      if (m[2]) segs.push({ text: m[2], marks, code: false });
      if (m[3]) segs.push({ text: m[3], marks, code: false });
    }
  }
  // 공백뿐인 조각: 마크를 앞뒤 이웃과 공통인 것만 남긴다.
  const blank = (s: Seg) => !s.code && s.text.trim() === '';
  segs.forEach((s, i) => {
    if (!blank(s) || s.marks.length === 0) return;
    const prev = segs[i - 1]?.marks ?? [];
    const next = segs[i + 1]?.marks ?? [];
    s.marks = s.marks.filter((m) => prev.some((p) => sameMark(p, m)) && next.some((x) => sameMark(x, m)));
  });
  return segs;
}

/** 코드 마크 글 — 안의 백틱보다 긴 백틱으로 감싸고, 끝이 백틱이면 공백을 끼운다. */
function codeSpan(text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
  const tick = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${tick}${pad}${text}${pad}${tick}`;
}

/** 인라인 노드 → 마크다운. 마크는 스택으로 열고 닫는다 — 이어지는 마크는 유지하고, 새 마크는 오래 이어질 것부터 바깥에 연다. */
function inlineToMd(nodes: JSONContent[]): string {
  const segs = toSegs(nodes);
  let out = '';
  const stack: Mark[] = [];
  // 각 조각에서 마크 m 이 몇 조각 더 이어지나(바깥 정렬용).
  const runLength = (from: number, m: Mark) => {
    let k = from;
    while (k < segs.length && segs[k].marks.some((x) => sameMark(x, m))) k++;
    return k - from;
  };
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    // 링크 마크만 있고 글이 주소 그대로면 맨 URL 로 — 렌더러가 채팅 링크 규칙(앞뒤 글자 포함)으로 같은 링크를 다시 잡을 때만.
    if (stack.length === 0 && s.marks.length === 1 && s.marks[0].type === 'link' && !s.code) {
      const m = s.marks[0];
      let k = i;
      while (k < segs.length && !segs[k].code && segs[k].marks.length === 1 && sameMark(segs[k].marks[0], m)) k++;
      const text = segs.slice(i, k).map((x) => x.text).join('');
      const runEnds = !segs[k]?.marks.some((x) => sameMark(x, m));
      if (runEnds && isBareLink(text, String(m.attrs?.href ?? ''), out.at(-1) ?? '', segs[k]?.text[0] ?? '')) {
        out += text;
        i = k - 1;
        continue;
      }
    }
    // 유지할 바닥 — 스택 아래부터 이 조각에도 있는 마크까지.
    let keep = 0;
    while (keep < stack.length && s.marks.some((m) => sameMark(m, stack[keep]))) keep++;
    while (stack.length > keep) out += closeMark(stack.pop()!);
    const toOpen = s.marks
      .filter((m) => !stack.some((x) => sameMark(x, m)))
      // 같은 길이면 링크를 바깥에 — `**[a](u)**뒤` 는 닫는 ** 가 ) 와 한글 사이라 굵게가 안 닫히지만 `[**a**](u)뒤` 는 된다.
      .sort((a, b) => runLength(i, b) - runLength(i, a) || Number(b.type === 'link') - Number(a.type === 'link'));
    for (const m of toOpen) {
      out += openMark(m);
      stack.push(m);
    }
    out += s.code ? codeSpan(s.text) : s.text;
  }
  while (stack.length > 0) out += closeMark(stack.pop()!);
  return out;
}
