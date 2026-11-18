// 붙여넣은 서명(WP-1726) — 설정 › 메일 계정 「서명」 카드가 붙여넣기를 받았을 때 쓰는 순수 함수.
// 바깥에는 toPastedSignatureHtml 하나만 낸다(편집기 붙여넣기·「다시 붙여넣기」 칸이 같이 쓴다). 붙여 넣은 HTML 을 한 번만 열어
// - isRichSignature: 표·인라인 style·font·클래스 서식이 든 서명인가. 맞으면 tiptap 편집기(스키마 밖 서식을 지운다) 대신
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
 * 붙여넣은 서명 「원본 그대로」 모드로 받을 문서인가 — 표·인라인 style·font·(class + <style>) 중 하나라도 있으면 true.
 * 글자·굵게·링크만이면 false(지금처럼 편집기). ProseMirror 조각 표시(data-pm-slice)는 따로 보지 않는다 — 노트·Notion·Confluence 도
 * 붙이는 표시라 거기서 복사한 표 서명이 지워진다. 편집기 안 복사·붙여넣기는 편집기가 「통째로 바꾸는가」로 걸러 편집기에 둔다.
 */
function isRichSignature(doc: Document): boolean {
  if (doc.querySelector('table, font, [style]')) return true;
  return doc.querySelector('style') != null && doc.querySelector('[class]') != null;
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
    const body = text.slice(open + 1, j - 1);
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
 * - body·html 에 맞는 규칙(물려받는 기본 글꼴·색)은 body 가 사라지므로 결과 전체를 감싼 <div style> 로 옮긴다(그런 규칙이 있을 때만).
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
  if (rootRules.length === 0 || !rootStyle) return doc.body.innerHTML;
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
