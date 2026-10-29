// 매뉴얼 한 권을 완전한 HTML 문서로 렌더링한다(마크다운 → HTML). PDF 변환은 build.mjs 가 맡는다.
import { marked } from 'marked';
import { hasParts } from './books.mjs';
import { partOrderErrors } from './frontmatter.mjs';
import { parseFigureLine, renderFigure } from './figure.mjs';
import { esc } from './html.mjs';
import { codeLineMask, replaceChapterLinks, stripRepoLinks } from './markdown.mjs';

// audience 값 → 배지에 찍을 한국어 표기.
const AUDIENCE_LABEL = { member: '구성원', admin: '관리자', operator: '슈퍼어드민' };

/**
 * marked 에 넘기기 전 본문을 손본다.
 * - 그림 줄(한 줄 전체가 그림 지시문)은 renderFigure HTML 로 바꾼다(앞뒤 빈 줄로 HTML 블록을 분리).
 * - `[x](NN-slug.md)` → `#ch-<slug>`(대상 장이 없으면 텍스트만), `../` 링크 → 텍스트만(저장소 파일은 PDF 에서 의미 없음).
 * - 본문 첫 `# ` 줄은 버린다(제목은 프론트매터 title 로 다시 그린다).
 * 코드 펜스 안은 건드리지 않는다.
 */
function preprocess(body, slugByFile, boxesDoc, file) {
  let out = body.replace(/^\s*#\s+.*\n/, '');
  const lines = out.split('\n');
  // 펜스 판정은 검사 도구와 같은 규칙(``` 와 ~~~ 모두, 같은 문자로만 닫힘)을 쓴다.
  const code = codeLineMask(lines);
  const res = lines.map((line, i) => {
    if (code[i]) return line;
    const fig = parseFigureLine(line);
    if (fig) return `\n${renderFigure(fig, boxesDoc)}\n`;
    // 절 앵커(#sec)는 무시하고 장 앵커로만 보낸다. 책에 없는 장 파일을 가리키면 깨진 링크이므로 빌드를 멈춘다
    // (검사 도구도 같은 링크 규칙으로 [장 링크 없음] 을 보고한다).
    const linked = replaceChapterLinks(line, (text, target) => {
      const slug = slugByFile.get(target);
      if (!slug) throw new Error(`${file}: 책에 없는 장으로 링크합니다: ${target}`);
      return `[${text}](#ch-${slug})`;
    });
    return stripRepoLinks(linked);
  });
  return res.join('\n');
}

/**
 * 인용문 첫 줄 표지에 따라 요약 상자·알림 상자 클래스를 붙이고,
 * 그림 바로 뒤의 번호 목록에 steps 클래스를 붙인다(번호를 그림 표식과 같은 빨간 원으로 그리기 위해 — 다른 목록은 그대로).
 */
function markBlocks(html) {
  let out = html.replace(/(<\/figure>\s*)<ol>/g, '$1<ol class="steps">').replace(
    /<blockquote>\s*<p><strong>이 장에서 할 수 있는 일<\/strong>([\s\S]*?)<\/blockquote>/g,
    '<aside class="summary"><p><strong>이 장에서 할 수 있는 일</strong>$1</aside>',
  );
  for (const [label, cls] of [['경고', 'warning'], ['주의', 'caution'], ['참고', 'note']]) {
    out = out.replaceAll(
      `<blockquote>\n<p><strong>${label}</strong>`,
      `<blockquote class="adm adm-${cls}"><p><strong>${label}</strong>`,
    );
  }
  return out.replace(/<blockquote>\s*<p>TODO\(/g, '<blockquote class="adm adm-todo"><p>TODO(');
}

/**
 * `## AI 와 함께…` 제목부터 다음 `##`(또는 끝)까지를 <section class="ai-with"> 로 감싼다.
 * 렌더된 HTML 에서 h2 경계로 자른다 — 마크다운 단계에서 하면 중첩 블록 처리가 복잡해진다.
 */
function wrapAiSections(html) {
  const parts = html.split(/(?=<h2[ >])/);
  return parts
    .map((part) => (/^<h2[^>]*>\s*AI 와 함께/.test(part) ? `<section class="ai-with">${part}</section>` : part))
    .join('');
}

// 장 하나를 <section class="chapter"> 로 만든다.
// 상대 경로 이미지 src 에 assetBase 를 붙인다(그림 지시문·일반 마크다운 이미지 공통). 절대 URL·data: 는 그대로.
function prefixImages(html, assetBase) {
  return html.replace(/(<img\b[^>]*?\bsrc=")(?![a-z][a-z0-9+.-]*:|\/|#)([^"]*")/gi, `$1${assetBase}$2`);
}

function renderChapter(ch, slugByFile, boxesDoc, assetBase) {
  const md = preprocess(ch.body, slugByFile, boxesDoc, ch.file);
  const html = prefixImages(wrapAiSections(markBlocks(marked.parse(md))), assetBase);
  const badge = (ch.meta.audience ?? []).map((a) => AUDIENCE_LABEL[a] ?? a).join(' · ');
  return (
    `<section class="chapter" id="ch-${esc(ch.meta.slug)}">` +
    `<p class="chapter-num">${String(ch.number).padStart(2, '0')}</p>` +
    `<h1>${esc(ch.meta.title)}</h1><p class="badge">${esc(badge)}</p>` +
    `${html}</section>`
  );
}

/**
 * 장을 부 단위 묶음 [{ part, chapters }] 으로 나눈다(부가 바뀔 때마다 새 묶음). 부 구분이 없는 책은 part 가 undefined 인 한 묶음.
 * 목차와 본문이 같은 묶음을 써서 부 제목·속지 위치가 어긋나지 않게 한다.
 */
function groupByPart(book, chapters) {
  if (!hasParts(book)) return [{ part: undefined, chapters }];
  const groups = [];
  for (const ch of chapters) {
    const last = groups[groups.length - 1];
    if (last && last.part === ch.meta.part) last.chapters.push(ch);
    else groups.push({ part: ch.meta.part, chapters: [ch] });
  }
  return groups;
}

// 목차: 부(있으면) 아래에 장 링크 목록. 쪽 번호는 넣지 않는다(링크로 이동).
function renderToc(book, groups) {
  let items = '';
  for (const g of groups) {
    if (g.part !== undefined) items += `<li class="toc-part">${esc(book.parts[g.part] ?? '')}</li>`;
    for (const ch of g.chapters) {
      items +=
        `<li><a href="#ch-${esc(ch.meta.slug)}"><span class="toc-num">${String(ch.number).padStart(2, '0')}</span>` +
        `${esc(ch.meta.title)}</a></li>`;
    }
  }
  return `<section class="toc"><h1>목차</h1><ul>${items}</ul></section>`;
}

/**
 * 한 권 전체를 완전한 HTML 문서로 렌더링한다.
 * 이미지·CSS 경로는 docs/manual/ 기준 상대(`shots/...`)이고 assetBase 접두로 출력 위치에서 docs/manual/ 까지의 상대 경로를 준다
 * (<base> 를 쓰면 `#ch-…` 링크가 깨지므로 쓰지 않는다).
 * boxesDoc 오류(알 수 없는 상자 키 등)는 그대로 던져 빌드를 멈춘다.
 */
export function renderBook(book, chapters, boxesDoc, { buildDate, assetBase = '' }) {
  const slugByFile = new Map(chapters.map((c) => [c.file, c.meta.slug]));
  // 부가 거꾸로 가면 속지가 다시 나와 목차·본문이 어긋나므로 빌드를 멈춘다(검사 도구는 [부 순서] 로 보고).
  if (hasParts(book)) {
    const [first] = partOrderErrors(chapters);
    if (first) throw new Error(first);
  }
  const groups = groupByPart(book, chapters);
  // 부 속지는 부가 바뀔 때만(부 구분이 없는 책은 생략) 그 부 첫 장 바로 앞에 둔다.
  const body = groups
    .map((g) => {
      const divider =
        g.part === undefined
          ? ''
          : `<section class="part-divider"><p class="part-num">${g.part}부</p><h1>${esc(book.parts[g.part] ?? '')}</h1></section>`;
      return divider + g.chapters.map((ch) => renderChapter(ch, slugByFile, boxesDoc, assetBase)).join('\n');
    })
    .join('\n');
  return (
    `<!doctype html><html lang="ko"><head><meta charset="utf-8">` +
    `<title>${esc(book.title)}</title>` +
    `<link rel="stylesheet" href="${assetBase}styles/manual.css"></head><body>` +
    `<section class="cover"><h1>${esc(book.title)}</h1><p class="subtitle">${esc(book.subtitle)}</p>` +
    `<p class="date">${esc(buildDate)}</p></section>` +
    `${renderToc(book, groups)}\n${body}</body></html>`
  );
}
