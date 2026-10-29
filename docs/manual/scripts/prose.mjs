// 매뉴얼 산문 검사: 굵게 문구를 앱 화면 문구와 대조하고 집필 실수를 잡는다.
// 사용: node prose.mjs [user|operator]  (인자 없으면 둘 다). 오류가 있으면 exit 1, 미확인 굵게는 목록만 출력.
// 알 수 없는 책이면 exit 2.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBooks, ROOT } from './lib/books.mjs';
import { collectUiStrings } from './lib/ui-strings.mjs';
import { checkProse } from './lib/prose-rules.mjs';
import { loadChapters } from './lib/chapters.mjs';
import { runBooks } from './lib/cli.mjs';

async function checkBook(book) {
  const chapters = await loadChapters(book);
  if (chapters.length === 0) return { lines: [`건너뜀 — ${book.key}: ${book.dir} 에 장이 없습니다`], errors: 0 };

  const ui = await collectUiStrings(path.join(ROOT, book.appSrc));
  const errors = [];
  const unverified = [];
  for (const { file, raw } of chapters) {
    // 줄 번호가 파일 기준이 되도록 프론트매터를 떼지 않은 원문을 검사한다(프론트매터엔 굵게가 없다).
    const r = checkProse(file, raw, ui);
    errors.push(...r.errors);
    unverified.push(...r.unverified);
  }
  const lines = [...errors];
  if (unverified.length > 0) {
    lines.push(`[미확인 굵게] ${unverified.length}건 (화면 문구에서 찾지 못함 — 사람이 확인)`, ...unverified.map((u) => `  ${u}`));
  }
  if (errors.length === 0) lines.push(`OK — ${book.key} 산문 검사 통과 (화면 문구 ${ui.size}개 수집)`);
  return { lines, errors: errors.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await runBooks(resolveBooks(process.argv[2], { all: true }), checkBook);
