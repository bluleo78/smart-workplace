// manual:check 의 도움말 검사(WP-1504) — 순수 함수. 매뉴얼 장이 도움말 패널·MCP 의 원본이 되므로 도움말 표기
// (제목 끝 `{help=<id> label=<이름>}`, 자리표시 `{agent.username}`, 조건 블록 `{if …}…{/if}`)·절 링크·화면 소스의 data-help 짝·
// 도움말 그림 PNG 의 있음/최신을 엄격하게 본다. 묶음 생성(buildHelpBundle)은 관대하게 문제 목록만 돌려주므로,
// 같은 판정을 두 번 구현하지 않도록 그 문제 목록을 표지로 바꿔 쓰고, 묶음이 보지 않는 것(표기 위치·이름 목록·층·예약 slug·
// data-help·그림 상태)만 여기서 더 본다. 출력 줄은 기존 check 처럼 `[표지] 파일:줄 내용`.
// 근거: docs/superpowers/specs/help-panel-design.md 9·14절, 계획 Task 4 표.
import { parseFigureLine } from './figure.mjs';
import { HELP_ID_RE, parseHeading, braceTokens, splitProseLines } from './help-markup.mjs';
import { PLACEHOLDERS, CONDITIONS } from './help-vars.mjs';
import { buildHelpBundle, chapterLines, collectFigures, splitSections } from './help-bundle.mjs';

// 묶음 문제 종류 → 검사 표지. figure-invalid 는 기존 check 의 [그림 지시문] 이, figure-missing 은 figureState 가 알리므로 뺀다.
const BUNDLE_LABEL = {
  'duplicate-id': '도움말 id 중복',
  'help-mark': '도움말 표시 오류',
  'link-unresolved': '절 링크 없음',
  'condition-block': '조건 블록',
};

/**
 * 장 하나의 본문 줄을 파일 기준 줄 번호와 함께 돌려준다 → [{ text, lineNo, code, segs }].
 * segs 는 산문·인라인 코드·HTML 주석 조각(splitProseLines — 묶음·PDF 와 같은 주석 규칙, 펜스 줄은 null).
 * 줄 번호·펜스 판정은 splitSections 와 같은 chapterLines 를 쓴다(프론트매터 줄 수만큼 밀어 파일 기준, CRLF 도 받는다).
 */
function bodyLines(ch) {
  const { lines, offset, code } = chapterLines(ch);
  const segs = splitProseLines(lines, code);
  return lines.map((text, i) => ({ text, lineNo: i + 1 + offset, code: code[i], segs: segs[i] }));
}

/**
 * 한 줄의 중괄호 표기를 검사해 err(표지, 메시지) 로 알린다.
 * place: 'prose'(일반 본문) | 'heading'(제목 — 표시를 뗀 제목 글) | 'figure'(그림 지시문 — 자리표시만 본다) | 'fence'(코드 펜스 안).
 * segs 를 주면(산문·그림 줄) 그 조각으로 보고 HTML 주석 조각은 건너뛴다 — 주석 안 글은 PDF·패널에 보이지 않으므로 표기가 아니다.
 * 주지 않으면(제목 글) 그 글 한 줄을 splitProseLines 로 나눈다 — 펜스 판정은 끈다(제목 글이 ``` 로 시작해도 한 줄 산문으로 본다).
 */
function checkBraces(text, place, err, segs = splitProseLines([text], [false])[0]) {
  if (place === 'fence') {
    // 펜스 안: 목록에 있는 자리표시만 표기다 — 목록 밖 `{이름.이름}` 은 JSX·템플릿 같은 코드 글자라 오류가 아니다(braceTokens inCode,
    // PDF·묶음과 같은 규칙). 조건 표기는 코드 안에 쓸 수 없다(설계 — 화면이 판정하지 못함).
    for (const t of braceTokens(text)) {
      if (t.kind === 'if' || t.kind === 'endif') err('조건 블록', `${t.raw} — 코드 블록 안에는 조건 블록을 쓸 수 없습니다`);
    }
    return;
  }
  for (const seg of segs) {
    if (seg.comment) continue;
    for (const t of braceTokens(seg.text, { inCode: seg.code })) {
      if (t.kind === 'placeholder') {
        if (place === 'heading' || place === 'figure') {
          err('자리표시 위치', `${t.raw} — 제목·그림 지시문에는 자리표시를 쓸 수 없습니다(브레드크럼·그림 설명에 날것이 보인다)`);
        } else if (!PLACEHOLDERS[t.name]) {
          // 인라인 코드 조각은 braceTokens 가 목록 안 이름만 돌려주므로 여기 오는 것은 산문의 목록 밖 이름뿐이다.
          err('자리표시 없음', `${t.raw} — 목록에 없는 자리표시입니다(lib/help-vars.mjs)`);
        }
        continue;
      }
      if (place === 'figure') continue; // 그림 지시문의 속성 중괄호({crop=… marks=…})는 표기가 아니다
      if (t.kind === 'help') err('도움말 표시 위치', `${t.raw} — 도움말 표시는 제목 줄 끝에만 쓴다`);
      else if (t.kind === 'unknown') err('알 수 없는 표기', `${t.raw} — 중괄호 글자를 그대로 보이려면 \\{ 로 쓴다`);
      else if (place === 'heading') err('조건 블록', `${t.raw} — 제목 줄에는 조건 블록을 쓸 수 없습니다`);
      else if (t.kind === 'if' && !CONDITIONS[t.name]) err('조건 블록', `${t.raw} — 목록에 없는 조건입니다(lib/help-vars.mjs)`);
    }
  }
}

/**
 * 도움말 검사. chapters 는 loadChapters 결과(한 책).
 * - screen: collectDataHelp 결과 { ids: [{ id, file, line }], dynamic } — 주면 data-help 짝·형식을 본다.
 * - figureState: help-figures.mjs figureState 결과 { missing, stale } — 주면(사용자 책) 도움말 그림 있음/최신을 본다.
 * → { errors: 오류 줄 목록, info: 정보 줄 목록(오류 아님) }.
 */
export function helpErrors(chapters, { screen, figureState } = {}) {
  const errors = [];
  const info = [];

  // 1) 묶음 생성과 같은 판정(id 중복·표시 형식·절 링크·조건 블록 짝)은 묶음 문제 목록에서 가져온다.
  const bundle = buildHelpBundle(chapters);
  for (const p of bundle.problems) {
    const label = BUNDLE_LABEL[p.kind];
    if (label) errors.push(`[${label}] ${p.file}:${p.line} ${p.message}`);
  }

  // 2) 줄마다 표기 위치·이름 목록을 본다(코드 펜스·인라인 코드·제목·그림 지시문을 가린다).
  for (const ch of chapters) {
    for (const { text, lineNo, code, segs } of bodyLines(ch)) {
      const err = (label, msg) => errors.push(`[${label}] ${ch.file}:${lineNo} ${msg}`);
      if (code) {
        checkBraces(text, 'fence', err);
        continue;
      }
      const h = parseHeading(text);
      if (h) {
        checkBraces(h.title, 'heading', err);
        continue;
      }
      let fig = null;
      try {
        fig = parseFigureLine(text);
      } catch {
        continue; // 형식이 틀린 그림 지시문은 기존 check 의 [그림 지시문] 이 알린다
      }
      checkBraces(text, fig ? 'figure' : 'prose', err, segs);
    }
  }

  // 3) 층 어긋남·예약 slug — 절 목록(묶음과 같은 순서)과 묶음의 parent 를 나란히 본다.
  const helpIds = new Set(bundle.index.flatMap((c) => c.sections.map((s) => s.id)).filter((id) => HELP_ID_RE.test(id)));
  chapters.forEach((ch, i) => {
    const split = splitSections(ch);
    const out = bundle.chapters[i].json.sections;
    split.forEach((s, j) => {
      if (s.anchor?.startsWith('_')) {
        errors.push(`[예약 slug] ${ch.file}:${s.line} "${s.anchor}" — \`_\` 로 시작하는 slug 는 장 첫머리 절(#_intro) 몫이라 제목을 \`_\` 로 시작하지 않는다`);
      }
      const { id, parent } = out[j];
      if (!HELP_ID_RE.test(id)) return; // 도움말 id 가 없는(대체 id) 절은 층 규칙 밖
      // id 의 점 접두 가운데 책에 있는 가장 긴 것 = 브레드크럼 parent 여야 한다(설계 6절 id 올라가기와 같은 경로).
      const parts = id.split('.');
      let expected = null;
      for (let k = parts.length - 1; k > 0 && expected === null; k--) {
        const prefix = parts.slice(0, k).join('.');
        if (helpIds.has(prefix)) expected = prefix;
      }
      if (expected !== parent) {
        errors.push(
          `[도움말 층 어긋남] ${ch.file}:${s.line} ${id} — 감싸는 절은 ${parent ?? '없음'} 인데 id 접두로는 ${expected ?? '없음'} 이다(제목 층과 id 층을 맞춘다)`,
        );
      }
    });
  });

  // 4) 화면 소스 data-help 짝.
  if (screen) {
    for (const { id, file, line } of screen.ids) {
      if (!HELP_ID_RE.test(id)) errors.push(`[data-help 형식] ${id} (${file}:${line})`);
      else if (!helpIds.has(id)) errors.push(`[data-help 짝 없음] ${id} (${file}:${line})`);
    }
    if (screen.dynamic > 0) info.push(`[data-help 동적] ${screen.dynamic}곳 — 정적 검사 밖`);
  }

  // 5) 도움말 그림 PNG(사용자 책만) — 그림 id 를 지시문 위치로 바꿔 보인다.
  if (figureState) {
    const at = new Map(collectFigures(chapters).map((f) => [f.id, `${f.file}:${f.line}`]));
    for (const id of figureState.missing) errors.push(`[도움말 그림 없음] ${at.get(id) ?? '?'} ${id} — pnpm manual:help-figures 로 만든다`);
    for (const id of figureState.stale) errors.push(`[도움말 그림 오래됨] ${at.get(id) ?? '?'} ${id} — 원본·표식이 바뀌었다, pnpm manual:help-figures 로 다시 만든다`);
  }

  return { errors, info };
}
