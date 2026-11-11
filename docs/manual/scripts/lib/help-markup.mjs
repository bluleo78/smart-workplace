// 매뉴얼 도움말 표기 해석(WP-1504). 매뉴얼 장이 도움말 패널·MCP·검색 색인의 원본이 되도록 세 가지 표기를 쓴다.
//   1) 절 제목 끝 도움말 표시  `## 저장소 토큰을 연결한다 {help=agent.run.repo label=저장소 연결}`
//   2) 자리표시               `{agent.username}` — 화면이 실제 값으로 채우고, PDF 는 「<AI 아이디>」로 보인다
//   3) 조건 블록               `{if app.customMcpServer}…{/if}` — PDF 는 꼬리표와 함께 그대로 보인다
// PDF 렌더(render.mjs)·묶음 생성·검사가 같은 해석을 쓰도록 이 모듈 하나에 둔다. marked 등 렌더러를 import 하지 않는다
// (묶음 생성이 웹 이미지 빌드에서 Node 내장만으로 돌아야 하므로). 근거: docs/superpowers/specs/help-panel-design.md 9·14절.
import { codeLineMask } from './markdown.mjs';
import { CONDITIONS, PLACEHOLDERS, placeholderLabel } from './help-vars.mjs';

// 도움말 id: 소문자·숫자·하이픈 마디를 점으로 잇는다(점은 층 — agent › agent.run › agent.run.repo). 빈 마디·대문자·`_` 는 안 된다.
export const HELP_ID_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

// 마크다운 ATX 제목 줄(들여쓰기 0~3칸). 그룹 1=`#` 들, 2=제목 글.
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t\r]*$/;
// 제목 끝의 도움말 표시 `{help…}`. 그룹 1=중괄호 안 글. 앞 공백까지 함께 잡아 지운 뒤 제목이 깔끔하게 남게 한다.
const HELP_MARK_RE = /[ \t]*\{(help\b[^{}]*)\}[ \t\r]*$/;
// 자리표시 이름: 소문자로 시작하고 점이 하나 이상(`agent.username`). 점 없는 `{foo}` 는 자리표시가 아니다(코드 속 JSON 등과 구분).
const PLACEHOLDER_NAME_RE = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/;
// 한 줄 안의 중괄호 덩어리(중첩·줄바꿈 없음).
const BRACE_RE = /\{([^{}\n]*)\}/g;

/**
 * 도움말 표시 안쪽 글(`help=a.b label=이름`)을 { id, label } 또는 { error } 로 푼다.
 * label 은 공백을 포함할 수 있어 `label=` 뒤 끝까지를 이름으로 본다. 속성은 help·label 둘뿐이라 다른 이름은 오타로 본다.
 */
function parseHelpAttrs(inner) {
  const m = /^help=(\S*)(?:[ \t]+([\s\S]*))?$/.exec(inner.trim());
  if (!m) return { error: `도움말 표시 형식이 아닙니다: {${inner}}` };
  const [, id, rest] = m;
  if (!HELP_ID_RE.test(id)) return { error: `도움말 id 형식이 아닙니다: "${id}" (소문자·숫자·하이픈 마디를 점으로 잇는다)` };
  if (rest === undefined) return { id, label: null };
  const lm = /^label=([\s\S]*)$/.exec(rest);
  if (!lm) return { error: `알 수 없는 속성입니다: "${rest}" (help·label 만 쓸 수 있다)` };
  const label = lm[1].trim();
  if (!label) return { error: '빈 label 입니다' };
  return { id, label };
}

/**
 * 제목 줄 해석. 제목이 아니면 null. 표시가 없으면 { level, title, id: null, label: null }.
 * 표시가 잘못됐으면 id·label 은 null 이고 error 에 이유(속성 오타·빈 label·id 형식)를 담는다. title 은 언제나 표시를 뗀 제목.
 * 코드 펜스 안인지는 호출 쪽이 가린다(이 함수는 한 줄만 본다).
 */
export function parseHeading(line) {
  const h = HEADING_RE.exec(line);
  if (!h) return null;
  const level = h[1].length;
  const mark = HELP_MARK_RE.exec(h[2]);
  if (!mark) return { level, title: h[2], id: null, label: null };
  const title = h[2].slice(0, mark.index).trim();
  const attrs = parseHelpAttrs(mark[1]);
  if (attrs.error) return { level, title, id: null, label: null, error: attrs.error };
  return { level, title, id: attrs.id, label: attrs.label };
}

/**
 * 중괄호 안 글로 토큰 종류를 정한다. 자리표시·조건 여닫기·도움말 표시가 아니면 unknown(산문에서는 검사 오류).
 */
function classify(inner) {
  if (PLACEHOLDER_NAME_RE.test(inner)) return { kind: 'placeholder', name: inner };
  const cond = /^if[ \t]+(\S+)$/.exec(inner);
  if (cond) return { kind: 'if', name: cond[1] };
  if (inner === '/if') return { kind: 'endif' };
  if (/^help\b/.test(inner)) return { kind: 'help' };
  return { kind: 'unknown' };
}

/**
 * 한 줄(또는 코드 조각)의 중괄호 표기 토큰을 나온 순서로 돌려준다.
 * 바로 앞이 `$`·`\` 인 중괄호는 셸 `${HOME}`·JS 템플릿 `${x.y}`·탈출로 보고 토큰으로 치지 않는다.
 * inCode 면 목록(PLACEHOLDERS)에 있는 자리표시만 돌려준다 — 코드 안의 JSON·조건 표기 꼴, JSX·템플릿의 `{props.title}` 같은
 * 글자는 코드 그대로 보여야 하므로. 산문과 달리 코드에서는 목록 밖 `{이름.이름}` 을 오타로 볼 수 없어(코드에서 흔한 글자) 그대로 둔다.
 * PDF 변환·묶음·검사가 모두 이 함수로 코드 속 자리표시를 가리므로 셋의 규칙이 같다.
 */
export function braceTokens(text, { inCode = false } = {}) {
  const out = [];
  for (const m of text.matchAll(BRACE_RE)) {
    const prev = m.index > 0 ? text[m.index - 1] : '';
    if (prev === '$' || prev === '\\') continue;
    const t = classify(m[1]);
    if (inCode && !(t.kind === 'placeholder' && Object.hasOwn(PLACEHOLDERS, t.name))) continue;
    out.push({ ...t, index: m.index, raw: m[0] });
  }
  return out;
}

// 백틱 n 개 덩어리로 연 인라인 코드의 닫는 자리(같은 길이 덩어리의 시작 위치)를 from 부터 찾는다. 없으면 -1.
function findCodeClose(line, from, n) {
  let k = from;
  while (k < line.length) {
    if (line[k] !== '`') {
      k++;
      continue;
    }
    let e = k;
    while (line[e] === '`') e++;
    if (e - k === n) return k;
    k = e;
  }
  return -1;
}

/**
 * 줄마다 산문·인라인 코드·HTML 주석 조각을 나눈다 → 줄마다 [{ text, code, comment }] (코드 펜스 줄은 null).
 * 조각 text 를 이어 붙이면 원문 줄이다. HTML 주석 `<!-- … -->` 은 PDF(marked)·웹 패널 모두 보이지 않으므로
 * 그 안의 중괄호는 표기가 아니다 — 검사·묶음·PDF 변환이 모두 이 함수로 주석을 가려 같은 규칙을 쓴다.
 * CommonMark 를 따라 왼쪽부터 먼저 나온 것이 이긴다(`\`<!--\`` 는 코드, 주석 안 백틱은 글자).
 * 주석으로 치는 것은 닫는 `-->` 가 있을 때뿐이다 — 줄 첫머리(들여쓰기 0~3칸)의 `<!--` 는 HTML 블록이라 빈 줄을 넘어
 * 뒤 줄에서 닫혀도 되고, 줄 가운데의 `<!--` 는 인라인 HTML 이라 같은 문단(빈 줄 전) 안에서 닫혀야 한다.
 * 닫히지 않은 `<!--` 는 글자 그대로라 그 뒤 표기를 검사가 놓치지 않는다.
 * 4칸 들여쓴 코드 블록은 가리지 않는다 — 목록 연속줄과 구분하려면 목록 문맥이 필요하고, codeLineMask(펜스만)와 같은 범위를 지킨다.
 */
export function splitProseLines(lines, code = codeLineMask(lines)) {
  // 줄 i 의 from 위치부터(뒤 줄 포함) 닫는 `-->` 가 있는지. block 이 아니면 빈 줄에서 멈춘다. 펜스 줄은 건너뛴다.
  const closable = (i, from, block) => {
    if (lines[i].indexOf('-->', from) >= 0) return true;
    for (let k = i + 1; k < lines.length; k++) {
      if (code[k]) continue;
      if (!block && lines[k].trim() === '') return false;
      if (lines[k].includes('-->')) return true;
    }
    return false;
  };
  let inComment = false;
  return lines.map((line, i) => {
    if (code[i]) return null;
    const out = [];
    const push = (text, kind) => {
      if (!text) return;
      const last = out[out.length - 1];
      if (last && !last.code && !last.comment && kind === 'text') last.text += text;
      else out.push({ text, code: kind === 'code', comment: kind === 'comment' });
    };
    let pos = 0;
    if (inComment) {
      const end = line.indexOf('-->');
      if (end < 0) {
        push(line, 'comment');
        return out;
      }
      push(line.slice(0, end + 3), 'comment');
      pos = end + 3;
      inComment = false;
    }
    let textStart = pos;
    while (pos < line.length) {
      if (line.startsWith('<!--', pos) && closable(i, pos + 4, /^ {0,3}$/.test(line.slice(0, pos)))) {
        push(line.slice(textStart, pos), 'text');
        const end = line.indexOf('-->', pos + 4);
        if (end < 0) {
          push(line.slice(pos), 'comment');
          inComment = true;
          return out;
        }
        push(line.slice(pos, end + 3), 'comment');
        pos = textStart = end + 3;
        continue;
      }
      if (line[pos] !== '`') {
        pos++;
        continue;
      }
      let j = pos;
      while (line[j] === '`') j++;
      const close = findCodeClose(line, j, j - pos);
      if (close < 0) {
        pos = j; // 짝 없는 백틱 — 글자로 두고 계속
        continue;
      }
      push(line.slice(textStart, pos), 'text');
      push(line.slice(pos, close + (j - pos)), 'code');
      pos = textStart = close + (j - pos);
    }
    push(line.slice(textStart), 'text');
    return out;
  });
}

// 목록 항목 줄(번호·글머리표, 들여쓰기 허용). 그룹 1=표지와 뒤 공백까지 — 꼬리표를 항목 글 앞에 끼울 자리.
const LIST_ITEM_RE = /^([ \t]*(?:\d{1,9}[.)]|[-*+])[ \t]+)/;
// 줄 전체가 조건 블록 여는/닫는 표기인 줄(줄 단위 꼴). 묶음의 그림 표식 짝짓기(stepsAfter)도 같은 판정으로 건너뛴다.
export const LINE_COND_RE = /^[ \t]*\{(?:if[ \t]+\S+|\/if)\}[ \t\r]*$/;

// 조건 블록 꼬리표 HTML. 목록에 없는 조건 이름은 검사가 막지만 렌더는 이름을 그대로 꼬리표로 보인다.
function condTag(name) {
  return `<span class="cond-tag">${CONDITIONS[name]?.tag ?? `(${name})`}</span>`;
}

// 코드(펜스·인라인) 안 목록에 있는 자리표시 → `<AI 아이디>` 그대로(목록 밖 `{props.title}` 등은 braceTokens 가 빼 글자로 남는다). marked 가 코드 안의 `<` 를 이스케이프하므로 PDF 에 글자로 보인다.
function replaceCodePlaceholders(text) {
  const toks = braceTokens(text, { inCode: true });
  if (!toks.length) return text;
  let out = '';
  let pos = 0;
  for (const t of toks) {
    out += text.slice(pos, t.index) + placeholderLabel(t.name);
    pos = t.index + t.raw.length;
  }
  return out + text.slice(pos);
}

/**
 * PDF 용 변환. 마크다운 본문을 받아 marked 에 넘기기 전 도움말 표기를 PDF 모양으로 바꾼다.
 * - 제목 끝의 올바른 도움말 표시는 지운다(잘못 쓴 표시는 글자로 남는다 — manual:check 가 막는다).
 * - 자리표시 → 표시 이름. 산문은 `&lt;AI 아이디&gt;`(그냥 `<…>` 를 넣으면 marked 가 HTML 태그로 먹는다), 코드 안은 `<AI 아이디>`.
 * - 조건 블록: 한 줄 꼴은 여는 표기를 꼬리표 span + 공백으로, 닫는 표기는 지운다.
 *   줄 단위 꼴(여는·닫는 줄이 그 표기만)은 여는 줄을 「빈 줄 + 같은 들여쓰기의 꼬리표 줄 + 빈 줄」로, 닫는 줄을 빈 줄로 바꾼다
 *   (앞 빈 줄은 꼬리표가 앞 문단·목록 항목에 이어 붙지 않고 제 문단이 되게 한다).
 *   단 여닫는 줄 바로 뒤가 목록 항목이면(번호 목록 사이·앞의 블록) 꼬리표는 그 항목 글 앞에 붙이고, 앞도 목록이면 여닫는 줄을
 *   지운다 — 들여쓰지 않은 꼬리표 문단·빈 줄이 끼면 <ol> 이 둘로 끊겨 그림 뒤 번호 목록(steps) 짝짓기가 깨지기 때문이다.
 *   앞이 문단이면 빈 줄로 남겨 목록이 문단에 이어 붙지 않게 한다.
 * - 코드 펜스 안의 조건 표기는 바꾸지 않는다(검사 오류).
 * - HTML 주석 안의 표기는 바꾸지 않는다(PDF 에 보이지 않는 글 — 검사·묶음도 주석 안은 보지 않는다, splitProseLines).
 * 표기가 하나도 없으면 입력과 같은 문자열을 돌려준다(줄을 나눠 다시 이은 것) — 표기 없는 장의 PDF 가 이 변환 전과 바이트 단위로 같게.
 * 닫히지 않은 조건 블록은 그 여는 줄 번호(본문 기준)와 함께 던진다(빌드를 멈춘다).
 */
export function applyHelpMarkupForPdf(body) {
  const lines = body.split('\n');
  const code = codeLineMask(lines);
  const segments = splitProseLines(lines, code); // 줄마다 산문·인라인 코드·HTML 주석 조각
  let depth = 0; // 열린 조건 블록 수(중첩은 검사 오류지만 렌더는 세기만 한다)
  let openLine = 0; // 가장 바깥 열린 블록의 줄 번호(1부터)
  // 줄 단위 조건 줄을 건너뛴 이웃 줄 — 연달아 놓인 `{/if}`·`{if …}` 도 한 경계로 본다.
  const neighbor = (i, step) => {
    let k = i + step;
    while (k >= 0 && k < lines.length && !code[k] && LINE_COND_RE.test(lines[k])) k += step;
    return k >= 0 && k < lines.length && !code[k] ? lines[k] : null;
  };
  // 목록 문맥 줄인가 — 목록 항목이거나 들여쓴 연속줄.
  const inList = (l) => l !== null && (LIST_ITEM_RE.test(l) || /^[ \t]+\S/.test(l));
  let pendingTag = null; // 다음 목록 항목 글 앞에 붙일 꼬리표(여는 줄 바로 뒤가 목록 항목일 때)
  const REMOVED = null; // 지운 줄 표지 — 마지막에 걸러 낸다
  const out = lines.map((line, i) => {
    const res = convertLine(line, i);
    if (pendingTag === null || res === REMOVED || !LIST_ITEM_RE.test(res) || LINE_COND_RE.test(line)) return res;
    const withTag = res.replace(LIST_ITEM_RE, `$1${pendingTag} `);
    pendingTag = null;
    return withTag;
  });
  // 줄 하나를 PDF 모양으로 바꾼다(REMOVED 면 그 줄을 지운다).
  function convertLine(line, i) {
    if (code[i]) return replaceCodePlaceholders(line);
    const cr = line.endsWith('\r') ? '\r' : '';
    // 제목 끝 표시 — 올바른 표시만 지운다.
    const h = parseHeading(line);
    let segs = segments[i];
    if (h?.id) {
      line = line.replace(HELP_MARK_RE, '') + cr;
      segs = splitProseLines([line])[0]; // 표시를 뗀 줄로 조각을 다시 나눈다(제목 줄은 주석 안에서 시작하지 않는다고 본다)
    }
    // 줄 전체가 HTML 주석이면 그대로 둔다 — 여러 줄 주석 안의 `{if …}` 한 줄이 꼬리표 줄로 바뀌지 않게.
    if (segs.every((seg) => seg.comment)) return line;
    // 줄 단위 조건 블록(줄 전체가 여는/닫는 표기).
    const trimmed = line.trim();
    const indent = /^[ \t]*/.exec(line)[0];
    const lineIf = /^\{if[ \t]+(\S+)\}$/.exec(trimmed);
    const nextIsItem = lineIf || trimmed === '{/if}' ? LIST_ITEM_RE.test(neighbor(i, 1) ?? '') : false;
    if (lineIf) {
      if (depth++ === 0) openLine = i + 1;
      if (nextIsItem) {
        pendingTag = condTag(lineIf[1]);
        return inList(neighbor(i, -1)) ? REMOVED : cr;
      }
      return `${cr}\n${indent}${condTag(lineIf[1])}${cr}\n${cr}`;
    }
    if (trimmed === '{/if}') {
      depth = Math.max(0, depth - 1);
      return nextIsItem && inList(neighbor(i, -1)) ? REMOVED : cr;
    }
    // 한 줄 안 표기 — 인라인 코드 조각과 산문 조각을 따로 바꾼다.
    // 바뀐 것이 없으면 조각을 이어 붙인 결과가 원문 줄과 같다(조각은 원문을 나눈 것).
    const parts = segs.map((seg) => {
      if (seg.comment) return seg.text;
      if (seg.code) return replaceCodePlaceholders(seg.text);
      const toks = braceTokens(seg.text).filter((t) => t.kind === 'placeholder' || t.kind === 'if' || t.kind === 'endif');
      if (!toks.length) return seg.text;
      let s = '';
      let pos = 0;
      for (const t of toks) {
        s += seg.text.slice(pos, t.index);
        if (t.kind === 'placeholder') {
          s += placeholderLabel(t.name).replace('<', '&lt;').replace('>', '&gt;');
        } else if (t.kind === 'if') {
          if (depth++ === 0) openLine = i + 1;
          s += `${condTag(t.name)} `;
        } else {
          depth = Math.max(0, depth - 1);
        }
        pos = t.index + t.raw.length;
      }
      return s + seg.text.slice(pos);
    });
    return parts.join('');
  }
  if (depth > 0) throw new Error(`닫히지 않은 조건 블록입니다: ${openLine}번째 줄의 {if …} 에 짝 {/if} 가 없습니다`);
  return out.filter((l) => l !== REMOVED).join('\n');
}
