// 채팅 본문 마크다운 부분집합 파서(WP-101) — 사람 메시지 렌더(ChatMarkdownText)·입력창 복원(chatMarkdownDoc)·평문 미리보기(stripChatMarkdown)가
// 모두 이 한 파서를 거친다. 화면과 편집기가 같은 본문을 서로 다르게 읽지 않게 하려는 것.
//
// 무엇을 서식으로 보나: **굵게** *기울임* ~~취소선~~ <u>밑줄</u> `코드` ```펜스 코드``` - 글머리 / 1. 번호 목록 [글](주소).
// 나머지 마크다운(제목 #·인용 >·구분선 ---·표·HTML·들여쓰기 코드·문자 참조 &amp;·역슬래시 이스케이프)은 꺼서 글자 그대로 둔다
// (이미지 ![]() 는 파서가 읽되 원문 글자로 되돌린다 — 끄면 `!` + 링크가 된다) —
// 서식 도입 전에 보낸 평문 메시지가 예전과 똑같이 보여야 해서다.
//
// 원문 보존: micromark 는 줄 앞뒤 공백을 버린다. 루트 문단의 글은 노드 값 대신 원문을 위치(offset)로 잘라 써서 들여쓰기·공백까지 예전과 같게 한다.
// 그러려면 파싱 전 원문 손질(가리기)이 같은 길이여야 한다 — 한 글자를 다른 한 글자로만 바꾼다.
import type { List, Nodes, Paragraph, Parent, PhrasingContent, Root, RootContent } from 'mdast';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { CHAT_LINK_RULES, splitLinks } from '@/lib/textLinks';

/** <u>…</u> 짝 — 마크다운에 밑줄이 없어 이 태그 한 가지만 서식으로 받는다(그 밖의 HTML 은 글자). */
export interface ChatUnderline extends Parent {
  type: 'chatUnderline';
  children: PhrasingContent[];
}

declare module 'mdast' {
  interface PhrasingContentMap {
    chatUnderline: ChatUnderline;
  }
  interface RootContentMap {
    chatUnderline: ChatUnderline;
  }
}

/** 끄는 micromark 구문 — 이름은 micromark-core-commonmark·gfm 확장의 construct name. */
const DISABLED_CONSTRUCTS = [
  'headingAtx',
  'setextUnderline',
  'blockQuote',
  'thematicBreak',
  // 4칸 들여쓴 줄이 코드 블록이 되지 않게 — 코드는 펜스(```)만.
  'codeIndented',
  'htmlFlow',
  'definition',
  // 이스케이프·문자 참조를 끄면 `\*`·`&amp;` 가 글자 그대로 남는다(입력창도 이스케이프를 만들지 않는다).
  'characterEscape',
  'characterReference',
  'hardBreakEscape',
  'autolink',
];

/**
 * remark 플러그인 — 위 구문을 끄고 GFM 중 취소선만 켠다(표·각주·할 일·맨 URL 자동 링크는 쓰지 않는다).
 * 맨 URL 링크는 기존 채팅 규칙(lib/textLinks)으로 따로 건다 — 서버 링크 미리보기와 경계가 같아야 해서.
 * singleTilde:false — `~5~` 같은 홑 물결은 취소선이 아니다(입력창은 ~~ 만 만든다).
 */
function chatSyntax(this: { data: () => { micromarkExtensions?: unknown[]; fromMarkdownExtensions?: unknown[] } }) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(gfmStrikethrough({ singleTilde: false }), { disable: { null: DISABLED_CONSTRUCTS } });
  (data.fromMarkdownExtensions ??= []).push(gfmStrikethroughFromMarkdown());
}

const processor = unified().use(remarkParse).use(chatSyntax);

// ── 같은 길이 가리기 ─────────────────────────────────────────────────────────

/** 가린 글자 ↔ 원래 글자. 사용자 영역(PUA) 문자는 micromark 가 문장부호·공백이 아닌 「글자」로 본다. */
class Masker {
  private readonly toPua = new Map<string, string>();
  private readonly fromPua = new Map<string, string>();
  private next = 0xf000;

  mask(ch: string): string {
    let p = this.toPua.get(ch);
    if (p === undefined) {
      p = String.fromCharCode(this.next++);
      this.toPua.set(ch, p);
      this.fromPua.set(p, ch);
    }
    return p;
  }

  unmask(s: string): string {
    if (this.fromPua.size === 0) return s;
    let out = '';
    for (const ch of s) out += this.fromPua.get(ch) ?? ch;
    return out;
  }
}

const PUNCT = /[\p{P}\p{S}]/u;
const SPACE = /\s/u;
const ASCII_ALNUM = /[A-Za-z0-9]/;
/** URL 안에서 가릴 글자 — 강조·코드·링크 구문으로 읽히면 주소가 깨진다. */
const URL_SYNTAX = new Set(['*', '_', '~', '`', '[', ']', '(', ')']);

/**
 * 파싱 전에 서식으로 읽히면 안 되는 글자를 같은 길이로 가린다.
 *  ① `_` 는 늘 글자 — 입력창은 `*` 만 쓰고, `snake_case`·`__init__` 가 굵게/기울임이 되면 안 된다(서버 미리보기도 같은 규칙).
 *  ② 맨 URL 안의 서식 기호 — `https://a/_b_`·`https://a/*x*` 가 깨지지 않게. URL 경계는 링크 규칙(splitLinks)과 같다.
 *  ③ 영숫자 사이 홑 `*` — `2*3*4` 는 곱셈이다.
 *  ④ 강조 기호가 문장부호와 한글 사이에 끼면 CommonMark 는 닫는(여는) 기호로 보지 않는다(`**(중요)**는`). 그 문장부호를 글자로 가려 강조가 닫히게 한다.
 */
function maskSource(body: string, masker: Masker): string {
  // UTF-16 위치 ↔ 코드포인트 위치가 어긋나지 않게 위치는 UTF-16 기준으로 다룬다(가리는 글자는 모두 BMP 라 길이가 같다).
  const out = body.split('');

  // ② URL — `](` 를 끊어 [글](주소) 의 글 쪽 URL 과 주소가 한 토큰으로 이어 붙지 않게(서버 LinkUrlExtractor 와 같은 처리).
  const scan = body.replaceAll('](', ']\u0000');
  let at = 0;
  for (const seg of splitLinks(scan, CHAT_LINK_RULES)) {
    if (seg.type === 'link') {
      for (let i = at; i < at + seg.text.length; i++) {
        if (URL_SYNTAX.has(out[i])) out[i] = masker.mask(out[i]);
      }
    }
    at += seg.text.length;
  }

  // 역슬래시 뒤 기호 — 이스케이프는 꺼 두었지만(역슬래시가 그대로 보인다) `\*별\*` 처럼 기호를 글자로 쓰려던 뜻은 지킨다.
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i] === '\\' && /[!-/:-@[-`{-~]/.test(out[i + 1])) {
      out[i + 1] = masker.mask(out[i + 1]);
      i++;
    }
  }

  // 줄 앞 `~~~` — 물결 펜스는 쓰지 않는다(입력창도 ``` 만 만든다). `~~~ 그럼 내일 봬요` 가 코드 블록이 되어 뒤를 다 삼키지 않게.
  for (const m of body.matchAll(/^ {0,3}(~{3,})/gm)) {
    const start = m.index + m[0].length - m[1].length;
    for (let i = start; i < start + m[1].length; i++) out[i] = masker.mask('~');
  }

  // 밑줄 태그 <u>·</u> 와 멘션 토큰 <@id> 는 통째로 「글자」로 가린다 — `**<u>굵게</u>**을`·`**<@5>**님` 처럼 강조 기호가
  // 꺾쇠(문장부호)와 한글 사이에 끼면 CommonMark 가 강조를 닫지(열지) 못한다. 밑줄은 파싱 뒤 글에서 다시 짝짓는다(pairUnderline).
  for (const m of body.matchAll(/<\/?u>|<@\d+>/gi)) {
    for (let i = m.index; i < m.index + m[0].length; i++) out[i] = masker.mask(out[i]);
  }

  // ① 모든 `_`.
  for (let i = 0; i < out.length; i++) if (out[i] === '_') out[i] = masker.mask('_');

  // ③ 영숫자 사이 홑 `*`.
  for (let i = 1; i < out.length - 1; i++) {
    if (out[i] === '*' && out[i - 1] !== '*' && out[i + 1] !== '*' && ASCII_ALNUM.test(out[i - 1]) && ASCII_ALNUM.test(out[i + 1])) {
      out[i] = masker.mask('*');
    }
  }

  // ④ 강조 기호 묶음(* 또는 ~ 연속) 양옆.
  for (let i = 0; i < out.length; ) {
    const c = out[i];
    if (c !== '*' && c !== '~') {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && out[j] === c) j++;
    const L = i > 0 ? out[i - 1] : undefined;
    const R = j < out.length ? out[j] : undefined;
    const isOther = (ch: string | undefined) => ch !== undefined && !SPACE.test(ch) && !PUNCT.test(ch);
    // 닫는 쪽: 앞이 문장부호, 뒤가 글자 → 앞 문장부호를 가린다. 코드·HTML·링크 구문 기호는 둔다.
    if (L !== undefined && PUNCT.test(L) && L !== '*' && L !== '~' && isOther(R) && canMaskBefore(out, i - 1)) {
      out[i - 1] = masker.mask(L);
    }
    // 여는 쪽: 앞이 글자, 뒤가 문장부호 → 뒤 문장부호를 가린다. 링크 [·]·코드 `·HTML < 는 구문이라 둔다.
    if (R !== undefined && PUNCT.test(R) && R !== '*' && R !== '~' && isOther(L) && !['[', ']', '`', '<'].includes(R)) {
      out[j] = masker.mask(R);
    }
    i = j;
  }
  return out.join('');
}

/** 강조 기호 바로 앞 문장부호(위치 k)를 가려도 되나 — 코드 `·HTML >·링크 [·링크 주소를 닫는 ) 는 구문이다. */
function canMaskBefore(out: string[], k: number): boolean {
  const ch = out[k];
  // 링크 여는 [ 도 구문이다(`[**a**](u)` — 여는 ** 의 앞).
  if (ch === '`' || ch === '>' || ch === '[') return false;
  if (ch === ')') {
    // 같은 줄에서 `](` 뒤로 공백·괄호 없이 이어진 ) 면 링크 주소 끝이다.
    let p = k - 1;
    while (p >= 0 && out[p] !== '\n' && out[p] !== ' ' && out[p] !== ')' && !(out[p] === '(' && out[p - 1] === ']')) p--;
    if (p > 0 && out[p] === '(' && out[p - 1] === ']') return false;
  }
  return true;
}

// ── 파싱 + 손질 ─────────────────────────────────────────────────────────────

export interface ChatMarkdown {
  tree: Root;
  /** 원문(가리기 전). 위치(offset)로 잘라 쓸 때 쓴다. */
  source: string;
}

/** 본문을 채팅 마크다운 트리로. 결과 트리의 글자(text·code·url)는 모두 원래 글자로 되돌려져 있다. */
export function parseChatMarkdown(body: string): ChatMarkdown {
  const masker = new Masker();
  const tree = processor.parse(maskSource(body, masker)) as Root;
  const ctx: Ctx = { source: body, masker };
  tree.children = tree.children.flatMap((b) => fixBlock(b, ctx, true));
  return { tree, source: body };
}

interface Ctx {
  source: string;
  masker: Masker;
}

/** 노드가 차지한 원문 조각. */
function sliceOf(node: Nodes, source: string): string {
  const s = node.position?.start.offset;
  const e = node.position?.end.offset;
  return s === undefined || e === undefined ? '' : source.slice(s, e);
}

/** 원문 조각을 글자 그대로 담은 문단 — 서식으로 보지 않을 블록의 대체물. 위치는 원래 블록 것을 그대로 둔다(빈 줄 계산용). */
function literalParagraph(node: Nodes, source: string): Paragraph {
  return { type: 'paragraph', children: [{ type: 'text', value: sliceOf(node, source), position: node.position }], position: node.position };
}

/**
 * 목록으로 보지 않을 모양 — 글자로 되돌린다.
 *  - 번호가 네 자리 이상(`2024. 10. 25. 회의` — 날짜). 서버 미리보기 규칙(1~3자리)과 같다.
 *  - 항목이 바로 또 목록으로 시작(`10. 25. 회의`·`- - -`).
 *  - 모든 항목이 비었음(`-` 한 줄).
 */
function isLiteralList(list: List): boolean {
  if (list.ordered && (list.start ?? 1) > 999) return true;
  if (list.children.every((item) => item.children.length === 0)) return true;
  return list.children.some((item) => item.children[0]?.type === 'list');
}

function fixBlock(block: RootContent, ctx: Ctx, root: boolean): RootContent[] {
  switch (block.type) {
    case 'paragraph': {
      block.children = fixPhrasing(block.children, ctx, root);
      // 루트 문단 첫 줄의 들여쓰기(최대 3칸)는 micromark 가 문단 밖으로 뺀다 — 원문에서 되살린다.
      const start = block.position?.start;
      if (root && start && start.column > 1) {
        const lead = ctx.source.slice(start.offset! - (start.column - 1), start.offset);
        if (lead.trim() === '') block.children.unshift({ type: 'text', value: lead });
      }
      return [block];
    }
    case 'list': {
      if (isLiteralList(block)) return [literalParagraph(block, ctx.source)];
      for (const item of block.children) {
        item.children = item.children.flatMap((c) => fixBlock(c, ctx, false)) as typeof item.children;
      }
      return [block];
    }
    case 'code':
      // 닫히지 않은 펜스(```만 있고 끝 ``` 없음)는 메시지 끝까지 삼키므로 글자 그대로 — 서버 미리보기도 닫힌 펜스만 코드로 본다.
      if (!/\n[ \t]*`{3,}[ \t]*$/.test(sliceOf(block, ctx.source))) return [literalParagraph(block, ctx.source)];
      block.value = ctx.masker.unmask(block.value);
      block.lang = null;
      block.meta = null;
      return [block];
    default:
      // 꺼 둔 구문이라 나오지 않지만(제목·인용 등) 혹시 나오면 글자 그대로.
      return [literalParagraph(block, ctx.source)];
  }
}

/** <u>/</u> 태그(대소문자 무시). */
const U_TAG = /<(\/?)u>/gi;

/**
 * 글 속 <u>…</u> 를 밑줄 노드로 — 같은 부모 안에서 여는 태그와 다음 닫는 태그를 짝짓는다(사이에 굵게 등 다른 노드가 있어도 된다).
 * 짝 없는 태그·부모가 다른 태그(`**<u>a**</u>`)는 글자 그대로. 태그는 파싱 전에 글자로 가려 두어 강조 판정을 방해하지 않는다.
 */
function pairUnderline(nodes: PhrasingContent[]): PhrasingContent[] {
  // 1) 글을 태그 기준으로 쪼갠다 — 태그는 표지(open/close)로.
  type Item = PhrasingContent | { tag: 'open' | 'close'; raw: string };
  const items: Item[] = [];
  for (const n of nodes) {
    if (n.type !== 'text' || !/<\/?u>/i.test(n.value)) {
      items.push(n);
      continue;
    }
    let last = 0;
    for (const m of n.value.matchAll(U_TAG)) {
      if (m.index > last) items.push({ type: 'text', value: n.value.slice(last, m.index) });
      items.push({ tag: m[1] ? 'close' : 'open', raw: m[0] });
      last = m.index + m[0].length;
    }
    if (last < n.value.length) items.push({ type: 'text', value: n.value.slice(last) });
  }
  if (items.length === nodes.length) return nodes;
  // 2) 여는 표지와 그 뒤 첫 닫는 표지를 짝지어 감싼다. 나머지 표지는 글자.
  const out: PhrasingContent[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!('tag' in it)) {
      out.push(it);
      continue;
    }
    const close = it.tag === 'open' ? items.findIndex((x, k) => k > i && 'tag' in x && x.tag === 'close') : -1;
    if (close > i) {
      out.push({ type: 'chatUnderline', children: items.slice(i + 1, close).map((x) => ('tag' in x ? { type: 'text', value: x.raw } : x)) });
      i = close;
    } else out.push({ type: 'text', value: it.raw });
  }
  return out;
}

function fixPhrasing(nodes: PhrasingContent[], ctx: Ctx, root: boolean): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    switch (n.type) {
      case 'text':
        // 루트 문단: 원문 조각(줄 앞뒤 공백 보존). 목록 안: 이어진 줄의 항목 들여쓰기는 버린 값 그대로.
        n.value = root && n.position ? sliceOf(n, ctx.source) : ctx.masker.unmask(n.value);
        out.push(n);
        break;
      case 'inlineCode':
        n.value = ctx.masker.unmask(n.value);
        out.push(n);
        break;
      case 'html':
        // HTML 은 글자(밑줄 태그는 가려 두어 여기 오지 않는다 — pairUnderline).
        out.push({ type: 'text', value: ctx.masker.unmask(n.value), position: n.position });
        break;
      case 'link':
        n.url = ctx.masker.unmask(n.url);
        n.title = null;
        n.children = fixPhrasing(n.children, ctx, root);
        out.push(n);
        break;
      case 'strong':
      case 'emphasis':
      case 'delete':
        n.children = fixPhrasing(n.children, ctx, root);
        out.push(n);
        break;
      case 'break':
        out.push(n);
        break;
      default:
        // 이미지·참조 등 꺼 둔 인라인 — 원문 글자.
        out.push({ type: 'text', value: n.position ? sliceOf(n, ctx.source) : '', position: n.position });
    }
  }
  return wrapAdjacentDelimiters(pairUnderline(out));
}

/** 겹친 강조의 바깥 기호 — 안쪽 노드를 감쌀 수 있는 짝 기호(긴 것부터). */
const OUTER_DELIMS: [string, 'strong' | 'emphasis' | 'delete'][] = [
  ['**', 'strong'],
  ['~~', 'delete'],
  ['*', 'emphasis'],
];

/**
 * 겹친 강조 바깥 기호를 되살린다 — `~~**굵**~~뒤`·`**~~x~~**뒤` 처럼 바깥 닫는(여는) 기호가 안쪽 기호(문장부호)와 한글 사이에 끼면
 * CommonMark 는 바깥 기호를 글자로 남긴다(앞 글자가 문장부호라 닫는 기호가 못 된다). 「글 끝 D」 + 서식 노드 + 「D 로 시작하는 글」 이면
 * 그 노드를 D 의 서식으로 감싼다. 안쪽이 이미 서식 노드일 때만이라 평문의 `~~a~~` 오판은 없다.
 */
function wrapAdjacentDelimiters(nodes: PhrasingContent[]): PhrasingContent[] {
  const out = [...nodes];
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i + 2 < out.length; i++) {
      const [a, mid, b] = [out[i], out[i + 1], out[i + 2]];
      if (a.type !== 'text' || b.type !== 'text' || mid.type === 'text' || mid.type === 'break') continue;
      const hit = OUTER_DELIMS.find(([d]) => a.value.endsWith(d) && b.value.startsWith(d));
      if (!hit) continue;
      const [d, type] = hit;
      const wrapped: PhrasingContent = { type, children: [mid] } as PhrasingContent;
      const before: PhrasingContent[] = a.value.length > d.length ? [{ type: 'text', value: a.value.slice(0, -d.length) }] : [];
      const after: PhrasingContent[] = b.value.length > d.length ? [{ type: 'text', value: b.value.slice(d.length) }] : [];
      out.splice(i, 3, ...before, wrapped, ...after);
      changed = true;
      break;
    }
  }
  return out;
}

// ── 공용 도우미 ─────────────────────────────────────────────────────────────

/**
 * 루트 블록 사이의 빈 줄 수(원문 줄 번호 차). 목록 앞뒤의 빈 줄 하나는 구분용이라 뺀다 —
 * 입력창이 목록과 이웃 문단 사이에 빈 줄을 하나 넣어 저장하기 때문이다(없으면 다음 문단이 마지막 항목에 붙는다).
 */
export function blankLinesBetween(prev: RootContent | undefined, next: RootContent): number {
  const nextLine = next.position?.start.line ?? 1;
  if (!prev) return Math.max(0, nextLine - 1);
  const prevLine = prev.position?.end.line ?? nextLine;
  const absorb = prev.type === 'list' || next.type === 'list' ? 1 : 0;
  return Math.max(0, nextLine - prevLine - 1 - absorb);
}

/** <@id> 멘션 토큰. */
export const MENTION_TOKEN = /<@(\d+)>/g;

/**
 * 맨 URL 로 써도 같은 링크로 읽히나 — 링크 글이 주소 그대로이고, 앞 글자(before)·뒤 글자(after)와 이어 써도
 * 채팅 링크 규칙이 그 글 전체를 그 주소로 잡을 때.
 */
export function isBareLink(text: string, href: string, before = '', after = ''): boolean {
  const segs = splitLinks(before + text + after, CHAT_LINK_RULES).filter((s) => s.type === 'link');
  return segs.length === 1 && segs[0].type === 'link' && segs[0].text === text && segs[0].href === href;
}

/** 링크 주소로 열어도 되는 것만 — http(s)·mailto. www. 는 https 를 붙인다. 그 밖(javascript: 등)은 null. */
export function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u)) return u;
  if (/^www\./i.test(u)) return `https://${u}`;
  return null;
}

/** 인라인 노드의 글자만(멘션 토큰 유지). */
function phrasingText(nodes: PhrasingContent[]): string {
  return nodes
    .map((n) => {
      if (n.type === 'text' || n.type === 'inlineCode') return n.value;
      if (n.type === 'break') return '\n';
      if ('children' in n) return phrasingText(n.children as PhrasingContent[]);
      return '';
    })
    .join('');
}

function blockText(b: RootContent): string {
  if (b.type === 'paragraph') return phrasingText(b.children);
  if (b.type === 'code') return b.value;
  if (b.type === 'list') {
    return b.children.map((item) => item.children.map((c) => blockText(c as RootContent)).join('\n')).join('\n');
  }
  return '';
}

/**
 * 서식 기호를 뺀 평문(WP-101) — 접근 이름·복사·짧은 미리보기용. 멘션 토큰 <@id> 는 그대로 둔다(이름 바꾸기는 호출처).
 * 목록 표시·펜스·강조 기호·<u> 는 빼고 글만, 줄바꿈은 유지한다.
 */
export function stripChatMarkdown(body: string): string {
  if (!body) return '';
  const { tree } = parseChatMarkdown(body);
  let out = '';
  let prev: RootContent | undefined;
  for (const b of tree.children) {
    if (prev) out += '\n'.repeat(blankLinesBetween(prev, b) + 1);
    out += blockText(b);
    prev = b;
  }
  return out;
}
