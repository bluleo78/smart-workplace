// 매뉴얼 구조 검사: 장 프론트매터의 routes 를 앱 라우터와 대조하고, 그림 지시문과 이모지도 점검한다.
// 사용: node check.mjs [user|operator]  (인자 없으면 둘 다). 오류가 하나라도 있으면 exit 1, 알 수 없는 책이면 exit 2.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasParts, resolveBooks, ROOT } from './lib/books.mjs';
import { boxesPath, readBoxesDoc } from './lib/boxes-file.mjs';
import { partOrderErrors, validateFrontmatter } from './lib/frontmatter.mjs';
import { parseFigureLine, validateFigure } from './lib/figure.mjs';
import { chapterLinkTargets, hasEmoji, proseLines } from './lib/markdown.mjs';
import { loadChapters } from './lib/chapters.mjs';
import { runBooks } from './lib/cli.mjs';
import { extractRoutes, matchRoute } from './lib/routes.mjs';

// 라우트가 아니라 매뉴얼 대상이 아닌 경로(와일드카드 404, OAuth 팝업 콜백).
const EXCLUDED_PATHS = new Set(['*', '/*', '/oauth/m365/callback']);

// validateFigure 의 문제 종류 → 검사 출력 표지.
const FIGURE_LABEL = { book: '그림 책 불일치', shot: '표식 그림 없음', key: '표식 키 없음', figure: '그림 오류' };

/**
 * 그림 지시문 한 줄을 검사해 오류 줄 목록을 돌려준다(순수 함수 — 파일 존재 확인은 exists 로 받는다).
 * PNG 존재만 여기서 보고([그림 없음], exists 는 docs/manual/ 기준 상대 경로를 받는다), 나머지는 빌드와 같은
 * validateFigure 판정을 표지로 바꿔 보고한다([그림 책 불일치]·[표식 그림 없음]·[표식 키 없음]·[그림 오류]).
 * at 은 메시지에 붙일 `파일:줄` 위치다. boxesDoc 이 null 이면(boxes.json 을 읽지 못함 — 따로 보고) 상자 검사는 건너뛰고 책 일치만 본다.
 */
export function checkFigureLine(fig, { book, boxesDoc, exists, at = '' }) {
  const where = at ? `${at} ` : '';
  const problems = validateFigure(fig, boxesDoc ?? {}, { book: book.key }).filter((p) => boxesDoc || p.kind === 'book');
  const line = (p) => `[${FIGURE_LABEL[p.kind]}] ${where}${p.subject}`;
  // 출력 순서는 책 불일치 → 그림 없음 → 상자 문제(이전 출력과 같게).
  const errors = problems.filter((p) => p.kind === 'book').map(line);
  if (!exists(fig.src)) errors.push(`[그림 없음] ${where}${fig.src}`);
  errors.push(...problems.filter((p) => p.kind !== 'book').map(line));
  return errors;
}

/**
 * 한 줄의 장 링크 `[x](NN-slug.md)` 중 책에 없는 장을 가리키는 것을 `[장 링크 없음] <at> <대상>` 으로 돌려준다.
 * 렌더(render.mjs)와 같은 링크 규칙(lib/markdown.mjs)을 써서, 빌드에서야 터지던 깨진 링크를 검사에서 먼저 잡는다.
 */
export function chapterLinkErrors(line, chapterFiles, at) {
  return chapterLinkTargets(line)
    .filter((t) => !chapterFiles.has(t))
    .map((t) => `[장 링크 없음] ${at} ${t}`);
}

/**
 * 장의 routes 패턴과 실제 경로를 대조한다(순수 함수).
 * - uncovered: 어떤 장도 덮지 않는 실제 경로
 * - ghosts: 어떤 실제 경로와도 맞지 않는 패턴 { pattern, file }
 * - duplicates: 둘 이상의 장이 덮는 실제 경로 { path, files }
 */
export function classify(chapters, actualPaths) {
  const coveredBy = new Map(actualPaths.map((p) => [p, []]));
  const ghosts = [];
  for (const ch of chapters) {
    for (const pattern of ch.routes) {
      const hits = actualPaths.filter((p) => matchRoute(pattern, p));
      if (hits.length === 0) ghosts.push({ pattern, file: ch.file });
      for (const p of hits) if (!coveredBy.get(p).includes(ch.file)) coveredBy.get(p).push(ch.file);
    }
  }
  const uncovered = [];
  const duplicates = [];
  for (const [p, files] of coveredBy) {
    if (files.length === 0) uncovered.push(p);
    else if (files.length > 1) duplicates.push({ path: p, files });
  }
  return { uncovered, ghosts, duplicates };
}

// 운영자 책: element 컴포넌트 파일이 ComingSoon 을 쓰면 아직 구현되지 않은 화면이라 장이 덮을 필요가 없다.
async function isComingSoon(book, element) {
  if (book.key !== 'operator' || !element) return false;
  const file = path.join(ROOT, book.appSrc, 'pages', `${element}.tsx`);
  if (!existsSync(file)) return false;
  return /\bComingSoon\b/.test(await readFile(file, 'utf-8'));
}

// 책 하나를 검사해 { lines, errors } 를 돌려준다. lines 는 출력할 모든 줄, errors 는 그중 오류 줄 수.
async function checkBook(book) {
  const loaded = await loadChapters(book);
  if (loaded.length === 0) return { lines: [`건너뜀 — ${book.key}: ${book.dir} 에 장이 없습니다`], errors: 0 };

  const lines = [];
  let errors = 0;
  const err = (msg) => {
    lines.push(msg);
    errors++;
  };

  const { doc: boxesDoc, error: boxesError } = await readBoxesDoc(boxesPath(book.key));
  if (boxesError) err(`[boxes.json] ${boxesError}`);
  // 그림 경로는 docs/manual/ 기준 상대(shots/<book>/<id>.png)다.
  const exists = (src) => existsSync(path.join(ROOT, 'docs/manual', src));

  const chapterFiles = new Set(loaded.map((c) => c.file));
  if (hasParts(book)) for (const e of partOrderErrors(loaded)) err(`[부 순서] ${e}`);

  for (const { file, meta, raw } of loaded) {
    for (const e of validateFrontmatter(meta, { file, book, raw })) err(`[프론트매터] ${e}`);

    for (const [lineNo, line] of proseLines(raw)) {
      if (hasEmoji(line)) err(`[이모지] ${file}:${lineNo}`);
      for (const e of chapterLinkErrors(line, chapterFiles, `${file}:${lineNo}`)) err(e);
      let fig;
      try {
        fig = parseFigureLine(line);
      } catch (e) {
        err(`[그림 지시문] ${file}:${lineNo} ${e.message}`);
        continue;
      }
      if (!fig) continue;
      for (const e of checkFigureLine(fig, { book, boxesDoc, exists, at: `${file}:${lineNo}` })) err(e);
    }
  }

  // 실제 경로 집합: 라우터의 pages 에서 제외 대상을 뺀다(redirects 는 애초에 pages 가 아니다).
  const { pages } = extractRoutes(await readFile(path.join(ROOT, book.appFile), 'utf-8'));
  const actual = [];
  for (const p of pages) {
    if (EXCLUDED_PATHS.has(p.path)) continue;
    if (await isComingSoon(book, p.element)) {
      lines.push(`[미구현 제외] ${p.path}`);
      continue;
    }
    actual.push(p.path);
  }

  const { uncovered, ghosts, duplicates } = classify(
    loaded.map((c) => ({ file: c.file, routes: c.meta.routes ?? [] })),
    actual,
  );
  for (const g of ghosts) err(`[유령 경로] ${g.pattern} (${g.file})`);
  for (const p of uncovered) err(`[미커버] ${p}`);
  for (const d of duplicates) err(`[중복] ${d.path}: ${d.files.join(', ')}`);

  if (errors === 0) lines.push(`OK — ${book.key} 경로 ${actual.length}개를 장이 모두 덮는다`);
  return { lines, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await runBooks(resolveBooks(process.argv[2], { all: true }), checkBook);
