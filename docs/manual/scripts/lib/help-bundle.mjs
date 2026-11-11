// 매뉴얼 도움말 묶음 생성(WP-1504). 사용자 매뉴얼 장을 절 단위 데이터로 묶어 도움말 패널·MCP·검색 색인이 함께 쓰는 산출물을 만든다:
//   manual-index.json        목차 — [{ chapter, title, routes, audience, sections: [{ id, label, title, parent }] }]
//   manual/<chapter>.json    장 하나 — 절마다 markdown(하위 절 제외)·figures·links
//   manual-vars.json         자리표시·조건 목록(값이 없을 때 보일 이름)
// 형식은 docs/superpowers/specs/help-panel-design.md 14절 계약이다 — 필드 이름은 바꾸거나 빼지 않고 더하기만 한다
// (더한 것: 장 number, 절 level, 표식 marks[].key, manual-vars.json).
// 웹 이미지 빌드(node:22-alpine, workplace-web 의존성만)에서 Vite 플러그인이 직접 부르므로 marked·Playwright 를 import 하지 않고
// Node 내장과 매뉴얼 lib 의 순수 모듈만 쓴다. 생성은 관대하다 — 내용 문제는 던지지 않고 problems 로 돌려주며
// (웹 빌드가 매뉴얼 글 때문에 멈추지 않게), 엄격한 판정은 manual:check·manual:help(CLI) 가 맡는다.
import { existsSync } from 'node:fs';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './books.mjs';
import { loadChapters } from './chapters.mjs';
import { codeLineMask, sectionLinks, stripRepoLinks } from './markdown.mjs';
import { parseFigureLine, parseMark } from './figure.mjs';
import { parseHeading, braceTokens, splitProseLines, LINE_COND_RE } from './help-markup.mjs';
import { PLACEHOLDERS, CONDITIONS } from './help-vars.mjs';

// 묶음 안 파일 이름(묶음 루트 기준). 웹은 /help/ 아래에, 서버는 자기 위치 아래에 같은 배치로 둔다(계획 「내가 정한 것」 4).
export const HELP_BUNDLE_FILES = {
  index: 'manual-index.json',
  chapterDir: 'manual',
  vars: 'manual-vars.json',
  figureDir: 'figures',
};

// 장 첫머리 절의 slug. 제목에서 나온 slug 는 `_` 로 시작하지 않으므로(검사가 막음) 겹치지 않는다.
const INTRO_SLUG = '_intro';
// 표식 label 최대 길이(글자). 넘으면 자르고 말줄임표를 붙인다 — 그림 옆 작은 설명이라 길면 읽히지 않는다.
const MARK_LABEL_MAX = 80;

/**
 * 제목 → GitHub 방식 앵커 slug(계획 「내가 정한 것」 8). 기존 장 안 링크(`#링크로-페이지를-공유한다`)가 이 규칙으로 풀린다.
 * 굵게·코드 표시를 떼고 NFC·소문자로 맞춘 뒤 글자·숫자·공백·`-`·`_` 밖 문자를 지우고 공백마다 `-` 로 바꾼다
 * (연속 공백은 `--` 처럼 그대로 남는다 — GitHub 와 같다). 장 안 중복 처리(-1, -2)는 호출 쪽(splitSections)이 한다.
 */
export function headingSlug(text) {
  return text
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
}

// 앞뒤 빈 줄을 뺀 범위 [시작, 끝)(가운데 빈 줄은 문단 구분이라 둔다).
function trimRange(lines) {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return [a, b];
}

/**
 * 장 본문을 줄로 나눈다 → { lines, offset, code }. CRLF 도 받는다.
 * offset 은 본문 줄 번호를 파일 기준으로 바꿀 때 더할 수(raw — 프론트매터 포함 원문 — 가 있으면 프론트매터 줄 수, 없으면 0),
 * code 는 코드 펜스 줄 표(codeLineMask). 절 나누기(splitSections)와 검사(manual:check)가 같은 줄 번호·펜스 판정을 쓰도록 한곳에 둔다.
 */
export function chapterLines(chapter) {
  const lines = chapter.body.split(/\r?\n/);
  const offset = chapter.raw ? chapter.raw.split(/\r?\n/).length - lines.length : 0;
  return { lines, offset, code: codeLineMask(lines) };
}

/**
 * 장을 절로 나눈다 → [{ level, title, id, label, slug, anchor, body, lineNos, line, error? }] (문서 순서, 첫머리 절이 맨 앞).
 * - 절 경계는 코드 펜스 밖의 제목 줄(#~######)이다. 절 본문은 제목 다음 줄부터 다음 제목 줄(층 무관) 앞까지 — 하위 절은 빠진다.
 * - 장 첫 `# ` 줄(앞에 다른 제목이 없을 때) 뒤~첫 제목 앞은 첫머리 절(level 1, slug `_intro`). `# ` 줄 앞 글도 첫머리에 넣는다.
 *   title 은 프론트매터 title, label 은 `# ` 줄 표시의 label(없으면 title), id 는 `# ` 줄 표시의 id(없으면 null).
 * - id·label 은 제목 표시 그대로(없거나 잘못됐으면 null — 잘못된 표시는 error 에 이유). 대체 id 는 책 전체를 보는 buildHelpBundle 이 정한다.
 * - slug 는 장 안에서 겹치면 `-1`, `-2` 를 붙인다(GitHub 규칙). anchor 는 GitHub 가 그 제목에 붙일 앵커로,
 *   첫머리 절은 `# ` 줄 제목의 slug 다(그 앵커를 가리키는 링크도 첫머리로 풀리게). 나머지 절은 slug 와 같다.
 * - line 은 제목 줄의 파일 기준 줄 번호(raw 가 있으면 프론트매터 포함, 없으면 본문 기준), lineNos 는 body 각 줄의 파일 기준 줄 번호
 *   (첫머리 절은 `# ` 줄 앞뒤 글을 이어 붙이므로 줄 번호가 이어지지 않을 수 있어 줄마다 둔다 — 문제 위치 표시용).
 * 줄 나누기는 CRLF 도 받는다.
 */
export function splitSections(chapter) {
  const { lines, offset, code } = chapterLines(chapter);
  const used = new Map(); // 기본 slug → 이미 쓴 횟수(GitHub 중복 규칙)
  const uniqueSlug = (title) => {
    const base = headingSlug(title);
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
  const title = chapter.meta?.title ?? '';
  const intro = { level: 1, title, id: null, label: title, slug: INTRO_SLUG, anchor: null, body: [], lineNos: [], line: 1 + offset };
  const sections = [intro];
  let cur = intro;
  let sawHeading = false;
  lines.forEach((text, i) => {
    const lineNo = i + 1 + offset;
    const h = code[i] ? null : parseHeading(text);
    if (!h) {
      cur.body.push(text);
      cur.lineNos.push(lineNo);
      return;
    }
    if (!sawHeading && h.level === 1) {
      // 장 제목 줄 — 첫머리 절의 표시·앵커만 가져오고 새 절은 만들지 않는다.
      sawHeading = true;
      intro.id = h.id;
      if (h.label) intro.label = h.label;
      if (h.error) intro.error = h.error;
      intro.anchor = uniqueSlug(h.title);
      intro.line = lineNo;
      return;
    }
    sawHeading = true;
    const slug = uniqueSlug(h.title);
    cur = { level: h.level, title: h.title, id: h.id, label: h.label ?? h.title, slug, anchor: slug, body: [], lineNos: [], line: lineNo };
    if (h.error) cur.error = h.error;
    sections.push(cur);
  });
  // 앞뒤 빈 줄을 지운다(줄 번호도 같이).
  for (const s of sections) {
    const [a, b] = trimRange(s.body);
    s.body = s.body.slice(a, b);
    s.lineNos = s.lineNos.slice(a, b);
  }
  return sections;
}

/**
 * 책 전체 그림 지시문을 문서 순서로 모아 그림 id 를 매긴다 → [{ id, fig, file, line }].
 * 그림 id 는 샷 id(`agents-1`), 같은 샷을 두 번째 이후로 쓰면 `<샷 id>~2`, `~3`(계획 「내가 정한 것」 11).
 * 묶음 생성과 도움말 그림 생성(Task 3)이 같은 id 를 쓰도록 이 함수 하나로 정한다. 형식이 틀린 지시문(알 수 없는 속성)은 건너뛴다.
 */
export function collectFigures(chapters) {
  const seen = new Map();
  const out = [];
  for (const ch of chapters) {
    for (const s of splitSections(ch)) {
      const code = codeLineMask(s.body);
      s.body.forEach((text, j) => {
        if (code[j]) return;
        let fig;
        try {
          fig = parseFigureLine(text);
        } catch {
          return;
        }
        if (!fig) return;
        const n = (seen.get(fig.shotId) ?? 0) + 1;
        seen.set(fig.shotId, n);
        out.push({ id: n === 1 ? fig.shotId : `${fig.shotId}~${n}`, fig, file: ch.file, line: s.lineNos[j] });
      });
    }
  }
  return out;
}

// 링크 앵커를 비교할 꼴로: 퍼센트 인코딩을 풀고(깨진 인코딩이면 그대로) NFC 로 맞춘다.
function normalizeAnchor(anchor) {
  let a = anchor;
  try {
    a = decodeURIComponent(anchor);
  } catch {
    // 잘못된 % 표기는 글자 그대로 비교한다
  }
  return a.normalize('NFC');
}

// 마크다운 조각을 표식 label 용 평문으로: 링크는 글만, 굵게·코드 표시를 떼고, 첫 문장만, 길면 자른다.
function markLabelText(text) {
  let t = text
    .replace(/(?<!!)\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim();
  const sentence = /^(.+?[.!?])(?=\s|$)/.exec(t);
  if (sentence) t = sentence[1];
  return t.length > MARK_LABEL_MAX ? `${t.slice(0, MARK_LABEL_MAX)}…` : t;
}

// 그림 줄 바로 뒤(빈 줄 건너뜀) 번호 목록의 항목 첫 줄 글들. PDF 가 그림 뒤 번호 목록을 표식 번호 원으로 그리는 규칙(markBlocks)과 같은 짝.
// 줄 단위 조건 줄(`{if …}`·`{/if}`)은 건너뛴다 — PDF 변환이 목록 사이·앞의 그 줄로 목록을 끊지 않으므로(applyHelpMarkupForPdf) 같은 짝을 맞춘다.
function stepsAfter(body, figIndex) {
  const items = [];
  const ITEM = /^\d+[.)][ \t]+(.*)$/;
  const skip = (line) => !line.trim() || LINE_COND_RE.test(line);
  let j = figIndex + 1;
  while (j < body.length && skip(body[j])) j++;
  if (j >= body.length || !ITEM.test(body[j])) return items; // 그림 바로 뒤가 번호 목록이 아니면 짝 없음
  for (; j < body.length; j++) {
    if (LINE_COND_RE.test(body[j])) continue;
    const item = ITEM.exec(body[j]);
    if (item) items.push(item[1]);
    else if (body[j].trim() && !/^[ \t]/.test(body[j])) break; // 들여쓰지 않은 다른 글 — 목록 끝(빈 줄·들여쓴 줄은 같은 목록)
  }
  return items;
}

// 14절 형식 검증용 작은 도구.
const isStr = (v) => typeof v === 'string';
const isStrArr = (v) => Array.isArray(v) && v.every(isStr);

/**
 * 장 목록(loadChapters 결과)으로 묶음을 만든다. 던지지 않는다 — 내용 문제는 problems 에 [{ file, line, kind, message }] 로 담는다.
 * kind: duplicate-id(같은 도움말 id 가 또 나옴 — 뒤의 절은 `<chapter>#<slug>` 로 떨어뜨림), help-mark(잘못된 제목 표시),
 *       link-unresolved(못 푼 절 링크 — 글만 남김), condition-block(짝이 맞지 않는 조건 블록 — 원문 유지),
 *       figure-missing(도움말 그림 PNG 없음 — figures 에서 뺌), figure-invalid(그림 지시문 형식 오류 — 원문 유지).
 * figureAvailable(figureId) 는 그 그림의 도움말 PNG 가 있는지(기본: 모두 있음). 같은 입력이면 같은 출력(시각·절대 경로를 넣지 않음).
 */
export function buildHelpBundle(chapters, { figureAvailable = () => true } = {}) {
  const problems = [];
  const problem = (file, line, kind, message) => problems.push({ file, line, kind, message });

  // 1) 장마다 절을 나누고 책 전체에서 도움말 id 를 하나씩만 준다(먼저 나온 것이 가짐 — 14절 「한 id 는 한 절에만」).
  const owner = new Map(); // 도움말 id → { file, line }
  const chapterSections = chapters.map((ch) => {
    const slug = ch.meta?.slug ?? ch.file.replace(/^\d+-/, '').replace(/\.md$/, '');
    const sections = splitSections(ch).map((s) => {
      if (s.error) problem(ch.file, s.line, 'help-mark', s.error);
      let helpId = s.id;
      if (helpId && owner.has(helpId)) {
        const first = owner.get(helpId);
        problem(ch.file, s.line, 'duplicate-id', `도움말 id "${helpId}" 가 이미 ${first.file}:${first.line} 에 있습니다 — 이 절은 대체 id 를 씁니다`);
        helpId = null;
      }
      if (helpId) owner.set(helpId, { file: ch.file, line: s.line });
      return { ...s, helpId, sid: helpId ?? `${slug}#${s.slug}` };
    });
    return { ch, slug, sections };
  });

  // 2) 링크 해석 표: 장 파일 → 장 정보, 장 안 앵커(slug·GitHub 앵커) → 절 id, 도움말 id → 장 파일.
  const byFile = new Map();
  for (const c of chapterSections) {
    const anchors = new Map();
    for (const s of c.sections) {
      anchors.set(s.slug, s.sid);
      if (s.anchor && !anchors.has(s.anchor)) anchors.set(s.anchor, s.sid);
    }
    byFile.set(c.ch.file, { ...c, intro: c.sections[0].sid, anchors });
  }
  const helpFile = new Map([...owner].map(([id, loc]) => [id, loc.file]));
  // 링크 하나 → 절 id(못 풀면 null). 다른 장 파일을 적었으면 그 장의 도움말 id·절 앵커만 본다.
  // 파일 없는 링크(`#…`)는 이 장 앵커를 먼저 보고, 없을 때만 책 전체 도움말 id 를 본다 — 이 장의 제목 slug 가 다른 장의 도움말 id 와
  // 글자가 같을 때(`## setup` 과 남의 `{help=setup}`) 쓴 사람이 뜻한 이 장 절로 가게 한다(GitHub 미리보기와 같은 곳).
  const resolve = (link, here) => {
    const target = link.file ? byFile.get(link.file) : here;
    if (!target) return null;
    if (!link.anchor) return target.intro;
    const a = normalizeAnchor(link.anchor);
    const hf = helpFile.get(a);
    if (link.file) return hf === link.file ? a : (target.anchors.get(a) ?? null);
    return target.anchors.get(a) ?? (hf ? a : null);
  };

  // 3) 그림 id(책 전체 문서 순서) — 위치(파일:줄)로 찾는다.
  const figureIdAt = new Map(collectFigures(chapters).map((f) => [`${f.file}:${f.line}`, f.id]));

  const figures = [];
  const index = [];
  const outChapters = [];
  for (const c of chapterSections) {
    const here = byFile.get(c.ch.file);
    const stack = []; // 감싸는 절들(level 오름차순)
    const sections = c.sections.map((s) => {
      // parent: 감싸는 위 층 가운데 가장 가까운, 도움말 id 가 있는 절(없으면 null).
      while (stack.length && stack[stack.length - 1].level >= s.level) stack.pop();
      const parent = stack.findLast((p) => p.helpId)?.helpId ?? null;
      stack.push(s);

      const code = codeLineMask(s.body);
      const segments = splitProseLines(s.body, code); // 산문·인라인 코드·HTML 주석 조각(검사·PDF 와 같은 주석 규칙)
      const links = [];
      const sectionFigures = [];
      let depth = 0; // 조건 블록 깊이 — 절 안에서 짝이 맞아야 한다(제목을 넘는 블록·중첩·짝 없는 닫기는 문제)
      let openLine = s.line; // 가장 바깥 열린 조건 블록의 줄(닫히지 않았을 때 그 줄을 가리킨다)
      const md = s.body.map((text, j) => {
        if (code[j]) return text;
        const lineNo = s.lineNos[j];
        // 그림 지시문 줄 → ![alt](figure:<id>). 그림 PNG 가 있으면 figures 에 싣는다.
        let fig = null;
        try {
          fig = parseFigureLine(text);
        } catch (e) {
          problem(c.ch.file, lineNo, 'figure-invalid', e.message);
          return text;
        }
        if (fig) {
          // collectFigures 가 같은 규칙(펜스 밖·형식이 맞는 지시문)으로 모든 그림에 id 를 매겨 두었으므로 늘 있다.
          const id = figureIdAt.get(`${c.ch.file}:${lineNo}`);
          if (figureAvailable(id)) {
            const steps = stepsAfter(s.body, j);
            const src = `${HELP_BUNDLE_FILES.figureDir}/${id}.png`;
            sectionFigures.push({
              id,
              src,
              alt: fig.alt,
              marks: fig.marks.map((entry, k) => {
                const key = parseMark(entry).key;
                // 짝 항목이 없거나 글이 비면(예: 표시만 있는 항목) 표식 키로 대신한다 — 빈 label 은 패널에 아무것도 보이지 않는다.
                const label = k < steps.length ? markLabelText(steps[k]) : '';
                return { n: k + 1, label: label || key, key };
              }),
            });
            figures.push({ id, shotId: fig.shotId, src, fig });
          } else {
            problem(c.ch.file, lineNo, 'figure-missing', `도움말 그림 ${id}.png 가 없어 묶음에서 뺍니다(pnpm manual:help-figures)`);
          }
          return `![${fig.alt}](figure:${id})`;
        }
        // 산문 조각만 본다(인라인 코드·HTML 주석 안 글자는 링크·표기가 아니다 — 주석은 패널에 보이지 않는다).
        return segments[j]
          .map((seg) => {
            if (seg.code || seg.comment) return seg.text;
            for (const t of braceTokens(seg.text)) {
              if (t.kind === 'if') {
                if (depth > 0) problem(c.ch.file, lineNo, 'condition-block', '조건 블록 안에 조건 블록을 열 수 없습니다');
                else openLine = lineNo;
                depth++;
              } else if (t.kind === 'endif') {
                if (depth === 0) problem(c.ch.file, lineNo, 'condition-block', '짝이 없는 {/if} 입니다');
                else depth--;
              }
            }
            let out = '';
            let pos = 0;
            for (const l of sectionLinks(seg.text)) {
              out += seg.text.slice(pos, l.index);
              const id = resolve(l, here);
              if (id === null) {
                problem(c.ch.file, lineNo, 'link-unresolved', `가리키는 절을 찾을 수 없습니다: ${l.raw}`);
                out += l.text;
              } else {
                out += `[${l.text}](help:${id})`;
                if (id !== s.sid && !links.includes(id)) links.push(id);
              }
              pos = l.index + l.raw.length;
            }
            return stripRepoLinks(out + seg.text.slice(pos));
          })
          .join('');
      });
      if (depth > 0) {
        problem(c.ch.file, openLine, 'condition-block', '닫히지 않은 조건 블록입니다 — {/if} 가 없거나 블록이 다음 제목을 넘습니다(블록은 한 절 안에서 닫는다)');
      }

      return {
        id: s.sid,
        label: s.label,
        title: s.title,
        parent,
        level: s.level,
        markdown: md.join('\n'),
        figures: sectionFigures,
        links,
      };
    });

    const head = {
      chapter: c.slug,
      number: c.ch.number,
      title: c.ch.meta?.title ?? '',
      routes: c.ch.meta?.routes ?? [],
      audience: c.ch.meta?.audience ?? [],
    };
    index.push({
      ...head,
      sections: sections.map(({ id, label, title, parent, level }) => ({ id, label, title, parent, level })),
    });
    outChapters.push({ chapter: c.slug, json: { ...head, sections } });
  }

  // 묶음 markdown 은 자리표시를 글자 그대로 둔다(화면이 채운다). 화면은 이 목록에 있는 이름만 채운다 — 코드 속 목록 밖 `{props.title}`
  // 같은 글자는 PDF(braceTokens inCode)·검사와 같이 그대로 보여야 하므로 「자리표시 꼴이면 모두」 바꾸면 안 된다.
  const vars = {
    placeholders: Object.entries(PLACEHOLDERS).map(([name, v]) => ({ name, display: v.display, description: v.description })),
    conditions: Object.entries(CONDITIONS).map(([name, v]) => ({ name, tag: v.tag, description: v.description })),
  };
  return { index, chapters: outChapters, vars, figures, problems };
}

/**
 * 책 하나(BOOKS 의 설정)를 읽어 묶음을 만든다 → { bundle, figuresDir, problemLines }.
 * CLI(manual:help)와 웹 vite 플러그인이 같은 준비(그림 폴더·그림 있음 판정·문제 줄 서식)를 쓰도록 한곳에 둔다.
 * - root 는 저장소 루트(기본 ROOT). 테스트가 깨진 책을 임시 폴더에 두려고 바꾼다 — loadChapters 는 ROOT 기준 상대 dir 을 받으므로
 *   다른 root 면 상대 경로로 바꿔 넘긴다.
 * - figuresDir 은 그 책의 도움말 그림 PNG 폴더(절대 경로) — 묶음은 여기 있는 그림만 싣는다.
 * - problemLines 는 형식 검증 오류(`[묶음 형식] …`, 생성기 버그 안전망) 뒤에 내용 문제(`[종류] 파일:줄 메시지`)를 이은 줄 목록.
 */
export async function buildBookHelpBundle(conf, root = ROOT) {
  const figuresDir = path.join(root, conf.help.figuresDir);
  const chapters = await loadChapters({ ...conf, dir: path.relative(ROOT, path.join(root, conf.dir)) });
  const bundle = buildHelpBundle(chapters, {
    figureAvailable: (id) => existsSync(path.join(figuresDir, `${id}.png`)),
  });
  const problemLines = [
    ...validateBundle(bundle).map((e) => `[묶음 형식] ${e}`),
    ...bundle.problems.map((p) => `[${p.kind}] ${p.file}:${p.line} ${p.message}`),
  ];
  return { bundle, figuresDir, problemLines };
}

/**
 * 묶음이 14절 형식을 지키는지 본다 → 오류 문장 목록(빈 배열 = 통과).
 * 필드 존재·형, 목차와 장 파일의 짝(장 순서·절 id 순서), 절 id 유일, parent·links 가 책에 있는 id 인지 확인한다.
 */
export function validateBundle({ index, chapters }) {
  const errors = [];
  const err = (m) => errors.push(m);
  const checkHead = (h, where) => {
    if (!h || typeof h !== 'object') return err(`${where}: 객체가 아닙니다`);
    if (!isStr(h.chapter) || !h.chapter) err(`${where}: chapter 가 문자열이 아닙니다`);
    if (!isStr(h.title)) err(`${where}: title 이 문자열이 아닙니다`);
    if (!isStrArr(h.routes)) err(`${where}: routes 가 문자열 배열이 아닙니다`);
    if (!isStrArr(h.audience)) err(`${where}: audience 가 문자열 배열이 아닙니다`);
    if (!Array.isArray(h.sections)) err(`${where}: sections 가 배열이 아닙니다`);
  };
  const checkSectionHead = (s, where) => {
    if (!s || typeof s !== 'object') return err(`${where}: 절이 객체가 아닙니다`);
    for (const k of ['id', 'label', 'title']) if (!isStr(s[k]) || !s[k]) err(`${where}: ${k} 가 비었거나 문자열이 아닙니다`);
    if (!('parent' in s) || (s.parent !== null && !isStr(s.parent))) err(`${where}: parent 는 문자열 또는 null 이어야 합니다`);
  };

  if (!Array.isArray(index)) return [`manual-index.json 이 배열이 아닙니다`];
  if (!Array.isArray(chapters)) return [`장 목록이 배열이 아닙니다`];
  index.forEach((h, i) => {
    checkHead(h, `manual-index.json[${i}]`);
    (h?.sections ?? []).forEach((s, j) => checkSectionHead(s, `manual-index.json[${i}].sections[${j}]`));
  });

  const ids = new Set();
  const refs = []; // [where, id] — 모든 id 를 모은 뒤 확인
  chapters.forEach((c, i) => {
    const where = `manual/${c?.chapter}.json`;
    const json = c?.json;
    checkHead(json, where);
    if (!json || !Array.isArray(json.sections)) return;
    if (c.chapter !== json.chapter) err(`${where}: 파일 이름과 chapter(${json.chapter})가 다릅니다`);
    const ix = index[i];
    if (!ix || ix.chapter !== json.chapter) err(`${where}: 목차 ${i}번째 장(${ix?.chapter})과 짝이 맞지 않습니다`);
    else {
      const a = (ix.sections ?? []).map((s) => s?.id).join('\n');
      const b = json.sections.map((s) => s?.id).join('\n');
      if (a !== b) err(`${where}: 목차의 절 목록과 장 파일의 절 목록이 다릅니다`);
    }
    json.sections.forEach((s, j) => {
      const sw = `${where} sections[${j}]`;
      checkSectionHead(s, sw);
      if (!s || typeof s !== 'object') return;
      if (ids.has(s.id)) err(`${sw}: 절 id "${s.id}" 가 겹칩니다`);
      ids.add(s.id);
      if (!isStr(s.markdown)) err(`${sw}: markdown 이 문자열이 아닙니다`);
      if (!isStrArr(s.links)) err(`${sw}: links 가 문자열 배열이 아닙니다`);
      else for (const l of s.links) refs.push([`${sw} links`, l]);
      if (isStr(s.parent)) refs.push([`${sw} parent`, s.parent]);
      if (!Array.isArray(s.figures)) err(`${sw}: figures 가 배열이 아닙니다`);
      else {
        s.figures.forEach((f, k) => {
          const fw = `${sw} figures[${k}]`;
          if (!f || typeof f !== 'object') return err(`${fw}: 객체가 아닙니다`);
          for (const key of ['id', 'src']) if (!isStr(f[key]) || !f[key]) err(`${fw}: ${key} 가 비었거나 문자열이 아닙니다`);
          if (!isStr(f.alt)) err(`${fw}: alt 가 문자열이 아닙니다`);
          if (!Array.isArray(f.marks)) err(`${fw}: marks 가 배열이 아닙니다`);
          else {
            f.marks.forEach((m, n) => {
              if (!m || !Number.isInteger(m.n) || !isStr(m.label)) err(`${fw} marks[${n}]: n(정수)·label(문자열)이 필요합니다`);
            });
          }
        });
      }
    });
  });
  if (index.length !== chapters.length) err(`목차 장 수(${index.length})와 장 파일 수(${chapters.length})가 다릅니다`);
  for (const [where, id] of refs) if (!ids.has(id)) err(`${where}: 책에 없는 절 id "${id}" 를 가리킵니다`);
  return errors;
}

/**
 * 묶음의 JSON 파일 목록 → [{ path, content }] (path 는 묶음 루트 기준, `/` 구분). 쓰기(CLI)와 Vite 플러그인 emitFile 이 같은 직렬화를 쓴다.
 * 2칸 들여쓰기 + 끝 줄바꿈 — 같은 입력이면 바이트 단위로 같다.
 */
export function bundleFiles(bundle) {
  const json = (v) => `${JSON.stringify(v, null, 2)}\n`;
  return [
    { path: HELP_BUNDLE_FILES.index, content: json(bundle.index) },
    ...bundle.chapters.map((c) => ({ path: `${HELP_BUNDLE_FILES.chapterDir}/${c.chapter}.json`, content: json(c.json) })),
    { path: HELP_BUNDLE_FILES.vars, content: json(bundle.vars) },
  ];
}

/**
 * 묶음을 outDir 아래에 쓴다: JSON 파일들 + 묶음이 가리키는 그림 PNG 를 figuresDir(`<id>.png`)에서 복사.
 * 출력 폴더를 비우는 일은 호출 쪽(CLI)이 한다 — 이 함수는 덮어쓰기만 한다.
 */
export async function writeHelpBundle(bundle, outDir, { figuresDir }) {
  for (const f of bundleFiles(bundle)) {
    const target = path.join(outDir, ...f.path.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, f.content);
  }
  if (bundle.figures.length) {
    const dir = path.join(outDir, HELP_BUNDLE_FILES.figureDir);
    await mkdir(dir, { recursive: true });
    for (const f of bundle.figures) await copyFile(path.join(figuresDir, `${f.id}.png`), path.join(dir, `${f.id}.png`));
  }
}
