// 붙여넣은 서명(WP-1726) — 설정 › 메일 계정 「서명」 카드가 붙여넣기를 받았을 때 쓰는 순수 함수.
// 바깥에는 toPastedSignatureHtml 하나만 낸다(편집기 붙여넣기·「다시 붙여넣기」 칸이 같이 쓴다). 붙여 넣은 HTML 을 한 번만 열어
// - isRichSignature: 표·font·클래스 서식·상자 서식이 든 서명인가(글자 서식 style 만이면 아니다). 맞으면 tiptap 편집기(스키마 밖 서식을 지운다) 대신
//   「붙여넣은 서명 · 원본 그대로」 미리 보기로 넘어가 원본 HTML 을 서버 정리만 거쳐 그대로 저장·발송한다.
// - inlineSignatureStyles: Outlook 이 <style> 의 클래스 규칙(p.MsoNormal 등)으로 준 글꼴·크기·색을 요소 인라인 style 로 옮긴다.
//   서버 정리기는 <style> 을 지우므로(받는 쪽 메일 클라이언트도 <style> 을 자주 버린다) 저장 전에 웹이 풀어 둔다.
//   CSS 파싱은 브라우저 CSSOM 대신 위 단계 규칙만 나누는 작은 파서로 한다 — DOMParser 문서의 sheet 유무가 엔진마다 달라서다.

/** 붙여 넣은 HTML 을 화면과 떨어진 문서로 연다 — 스크립트가 돌지 않고 이미지도 받지 않는다. */
function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/**
 * 붙여 넣은 HTML 을 「원본 그대로」 저장할 서명 HTML 로 — 서식 있는 서명이면 클래스 서식을 인라인으로 풀고 찌꺼기를 지운 HTML,
 * 글자·굵게·링크만이면(또는 비었으면) null(지금처럼 편집기가 받는다). 문서는 한 번만 연다.
 */
export function toPastedSignatureHtml(html: string): string | null {
  if (!html) return null;
  const doc = parseHtml(html);
  return isRichSignature(doc) ? inlineSignatureStyles(doc) : null;
}

/**
 * 서명 편집기에서 복사한 클립보드 HTML 표지 — 서명 편집기의 복사 직렬화기(signatureEditorExtensions)가 첫 최상위 요소에 단다.
 * 이 표지가 있으면 직접 쓴 서명을 Ctrl+A·C → Ctrl+A·V 로 되붙인 것이라 편집기에 둔다(WP-1726 코드 리뷰).
 * ProseMirror 의 data-pm-slice 는 노트·Notion·Confluence 같은 ProseMirror 앱이면 어디서나 붙어 쓰지 않는다(노트의 NOTE_COPY_ATTR 와 같은 방식).
 */
export const SIGNATURE_COPY_ATTR = 'data-wp-signature-copy';

/**
 * style 을 가져도 편집기가 담는 요소 — 서명 편집기 스키마(signatureEditorExtensions)가 style 을 남기는 것만이다:
 * span[style](글자 서식 mark)·문단·제목(블록 style 속성)·이미지(style 속성). 표·칸·font 는 위에서 따로 원본 모드로 본다.
 * 링크·굵게·기울임 같은 다른 글자 요소의 style 은 스키마가 버린다 — 예: `<a style="color:#000;text-decoration:none">` 가
 * 편집기로 가면 파란 밑줄 링크가 된다(WP-1726 2차 리뷰). 그래서 그런 요소의 style 은 효과 있는 값이 하나라도 있으면 원본 모드다.
 */
const EDITOR_STYLED_TAGS = new Set(['SPAN', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'IMG']);

/**
 * 상자 서식 속성 — 너비·높이·안쪽 여백·테두리·배치. 글자 요소·문단에 있어도 서명 배치(칸 나눔·세로 줄·고정 폭)를 만드는 서식이라
 * 원본 모드로 본다. margin·배경색은 크롬이 웹 글 복사에 늘 붙여 넣어 포함하지 않는다. 이미지의 크기 style 은 편집기가 담으므로 보지 않는다.
 */
const BOX_STYLE_PROPERTY = /^(width|min-width|max-width|height|min-height|max-height|padding[\w-]*|border[\w-]*|display|float|position)$/;

/**
 * 효과 없는 선언인가 — 판정에서 세지 않는다(WP-1726 2차 리뷰).
 * - 크롬은 웹 글자를 복사할 때 글자 요소에 `display: inline !important; float: none;` 을 붙인다. 글자 요소는 원래 inline·float 없음이라
 *   배치를 바꾸지 않는다 — 세면 「글자 서식만 든 크롬 웹 글은 편집기」 결정이 가장 흔한 경우에 지켜지지 않는다.
 * - 굵게 요소(b·strong)의 `font-weight: normal|400` 은 Google 문서 복사가 전체를 감싸는 `<b style="font-weight:normal">` 이다.
 *   편집기의 굵게 규칙도 이 요소를 굵게로 읽지 않아 결과가 같다.
 */
function isNeutralDeclaration(tagName: string, property: string, value: string): boolean {
  if (property === 'display') return value === 'inline';
  if (property === 'float') return value === 'none';
  if (property === 'font-weight' && (tagName === 'B' || tagName === 'STRONG')) return value === 'normal' || value === '400';
  return false;
}

/** 요소 style 의 효과 있는 선언 속성 이름들 — 소문자, !important 를 떼고 효과 없는 선언(isNeutralDeclaration)은 뺀다. */
function effectiveStyleProperties(el: Element): string[] {
  const out: string[] = [];
  for (const decl of (el.getAttribute('style') ?? '').split(';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    const property = decl.slice(0, colon).trim().toLowerCase();
    const value = decl
      .slice(colon + 1)
      .replace(/!\s*important/i, '')
      .trim()
      .toLowerCase();
    if (!property || isNeutralDeclaration(el.tagName, property, value)) continue;
    out.push(property);
  }
  return out;
}

/** 이 요소의 style 이 편집기로 가면 잃는 서식인가 — 스키마가 style 을 버리는 요소의 효과 있는 선언, 또는 이미지 밖 요소의 상자 서식. */
function hasStyleEditorLoses(el: Element): boolean {
  const properties = effectiveStyleProperties(el);
  if (properties.length === 0) return false;
  if (!EDITOR_STYLED_TAGS.has(el.tagName)) return true;
  return el.tagName !== 'IMG' && properties.some((property) => BOX_STYLE_PROPERTY.test(property));
}

/**
 * 붙여넣은 서명 「원본 그대로」 모드로 받을 문서인가. 판정(WP-1726 코드 리뷰 결정):
 * - 서명 편집기에서 복사한 것(SIGNATURE_COPY_ATTR)이면 false — 직접 쓴 서명은 편집기에 남는다.
 * - 표·<font>·(class + <style>) 가 있으면 true.
 * - 편집기 스키마가 style 을 버리는 요소(div·td·a·b 등)에 효과 있는 style 이 있거나, 이미지가 아닌 요소의 style 에 상자 서식이 있으면 true.
 * - 그 밖(글자·굵게·링크, 크롬 웹 글 복사처럼 span·문단의 글자 서식 style 만)은 false — 편집기가 그 서식을 그대로 담는다.
 */
function isRichSignature(doc: Document): boolean {
  if (doc.querySelector(`[${SIGNATURE_COPY_ATTR}]`)) return false;
  if (doc.querySelector('table, font')) return true;
  if (doc.querySelector('style') != null && doc.querySelector('[class]') != null) return true;
  return Array.from(doc.body.querySelectorAll('[style]')).some(hasStyleEditorLoses);
}

/** CSS 규칙 하나 — 쉼표로 나눈 선택자 목록과 선언 문자열. */
interface StyleRule {
  selectors: string[];
  declarations: string;
}

/**
 * <style> 글에서 맨 위 단계 일반 규칙만 꺼낸다. @media·@page·@font-face 같은 @ 규칙은 묶음째 건너뛴다(괄호 깊이를 세어 끝을 찾는다).
 * Outlook 은 규칙 전체를 <!-- --> 로 감싸므로 주석 표시와 CSS 주석도 지운다.
 */
function parseStyleRules(css: string): StyleRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--|-->/g, '');
  const rules: StyleRule[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const prelude = text.slice(i, open).trim();
    // 짝이 맞는 닫는 괄호 — @media 처럼 안에 규칙이 든 묶음도 한 번에 건너뛴다.
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
      j++;
    }
    // 닫는 괄호를 찾았으면 그 앞까지, 끝까지 못 찾았으면(잘린 CSS 의 마지막 규칙) 글 끝까지 — 마지막 글자를 잃지 않는다.
    const body = text.slice(open + 1, depth === 0 ? j - 1 : j);
    // `@charset "x";` 처럼 괄호 없는 @ 문이 앞에 붙어 오면 그 뒤만 선택자로 본다.
    const selectorText = prelude.slice(prelude.lastIndexOf(';') + 1).trim();
    if (selectorText && !selectorText.startsWith('@')) {
      rules.push({ selectors: splitSelectors(selectorText), declarations: body.trim() });
    }
    i = j;
  }
  return rules;
}

/** 선택자 목록을 맨 위 단계 쉼표로 나눈다 — :is(a, b) 같은 괄호 안 쉼표는 나누지 않는다. */
function splitSelectors(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) {
      out.push(text.slice(start, k).trim());
      start = k + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out.filter(Boolean);
}

/** 요소가 선택자에 맞는가 — 잘못된 선택자·브라우저가 모르는 선택자(::before 등)는 던지므로 맞지 않는 것으로 본다. */
function safeMatches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

/** 지울 찌꺼기 — 스타일·메타·링크·제목·XML 섬(Office 가 붙이는 문서 속성). */
const JUNK_SELECTOR = 'style, meta, link, title, xml';

/**
 * 붙여 넣은 문서의 <style> 클래스 규칙을 요소 인라인 style 로 옮기고 body 안 HTML 만 돌려준다.
 * - body·html 에 맞는 규칙과 <body style>(물려받는 기본 글꼴·색)은 body 가 사라지므로 결과 전체를 감싼 <div style> 로 옮긴다
 *   (그런 규칙이나 body style 이 있을 때만 — <style> 이 없어도 body style 만으로 감싼다).
 * - 규칙 선언은 요소 인라인 style 앞에 둔다 — 같은 속성이면 요소 자신의 인라인 선언이 이긴다.
 * - 여러 규칙이 맞으면 나중 규칙이 이긴다(명시도는 따지지 않는 근사 — Outlook 서명은 거의 클래스 하나짜리 규칙이다).
 * - <html>·<head> 껍데기, <style>·<meta>, 주석(조건부 주석·StartFragment 표시 포함), <o:p> 같은 Office 이름공간 태그(내용은 남김)를 지운다.
 */
function inlineSignatureStyles(doc: Document): string {
  const rules = Array.from(doc.querySelectorAll('style')).flatMap((s) => parseStyleRules(s.textContent ?? ''));

  // body·html 규칙 — body 의 인라인 style 이 이긴다(요소 규칙과 같은 순서).
  const rootRules = rules.filter((r) =>
    r.selectors.some((sel) => safeMatches(doc.body, sel) || safeMatches(doc.documentElement, sel)),
  );
  const rootStyle = joinDeclarations(rootRules, doc.body.getAttribute('style'));

  if (rules.length > 0) {
    for (const el of Array.from(doc.body.querySelectorAll('*'))) {
      const matched = rules.filter((r) => r.selectors.some((sel) => safeMatches(el, sel)));
      if (matched.length === 0) continue;
      const style = joinDeclarations(matched, el.getAttribute('style'));
      if (style) el.setAttribute('style', style);
    }
  }

  for (const junk of Array.from(doc.querySelectorAll(JUNK_SELECTOR))) junk.remove();
  removeComments(doc.body);
  unwrapNamespacedTags(doc.body);
  // body 규칙이 없어도 <body style> 이 있으면 감싼다 — 빼면 붙여 넣은 문서의 기본 글꼴·색이 사라진다.
  if (!rootStyle) return doc.body.innerHTML;
  const wrapper = doc.createElement('div');
  wrapper.setAttribute('style', rootStyle);
  wrapper.append(...Array.from(doc.body.childNodes));
  return wrapper.outerHTML;
}

/** 규칙 선언(앞 → 뒤 순서) 다음에 요소 자신의 인라인 선언을 이어 붙인다 — CSS 는 뒤 선언이 이기므로 요소 자신의 값이 이긴다. 없으면 ''. */
function joinDeclarations(rules: StyleRule[], own: string | null): string {
  const fromRules = rules.map((r) => r.declarations.replace(/;\s*$/, '')).filter(Boolean);
  return [...fromRules, own?.trim()].filter(Boolean).join(';');
}

/** 주석을 모두 지운다 — 조건부 주석(<!--[if gte mso 9]>…)과 클립보드 StartFragment 표시. */
function removeComments(root: Element): void {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const c of comments) c.parentNode?.removeChild(c);
}

/** <o:p>·<st1:…> 같은 Office 이름공간 태그는 벗기고 안 내용만 남긴다(빈 문단 자리 &nbsp; 같은 글자를 잃지 않게). */
function unwrapNamespacedTags(root: Element): void {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (!el.tagName.includes(':')) continue;
    el.replaceWith(...Array.from(el.childNodes));
  }
}
