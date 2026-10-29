#!/usr/bin/env node
/**
 * 매뉴얼 한 권을 HTML 로 렌더링하고 A4 PDF 로 인쇄한다.
 *
 *   node docs/manual/scripts/build.mjs [user|operator]   # 기본 user
 *
 * 결과: dist/manual/<book>/manual.html, dist/manual/<book>/<pdfName>
 * 종료 코드: 0 성공, 1 빌드 실패(장 없음·렌더링 오류·못 실은 그림), 2 사용법 오류(알 수 없는 책).
 * 실패해도 예전 결과물이 남지 않도록 렌더링 전에 HTML·PDF 를 먼저 지운다.
 * HTML → Chromium 인쇄 경로(docs/intro/scripts/build-pdf.mjs 와 같은 방식). Playwright 는 workplace-web 의 것을 쓴다.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveBooks, ROOT } from './lib/books.mjs';
import { boxesPath, readBoxesDoc } from './lib/boxes-file.mjs';
import { loadChapters } from './lib/chapters.mjs';
import { loadChromium } from './lib/cli.mjs';
import { renderBook } from './lib/render.mjs';

const [book] = resolveBooks(process.argv[2]); // 생략하면 user
const chromium = loadChromium();

// 그림 상자 파일. 아직 촬영 전이면 빈 문서, 깨져 있으면 렌더링 오류와 같은 한 줄로 실패한다.
async function loadBoxes() {
  const { doc, error } = await readBoxesDoc(boxesPath(book.key));
  if (error) throw new Error(error);
  return doc;
}

const buildDate = new Date().toISOString().slice(0, 10);
const outDir = path.join(ROOT, 'dist/manual', book.key);
const htmlPath = path.join(outDir, 'manual.html');
const pdfPath = path.join(outDir, book.pdfName);
// 실패한 빌드가 예전 HTML·PDF 를 남기지 않도록 렌더링 전에 먼저 지운다(남아 있으면 성공한 것처럼 보인다).
await rm(pdfPath, { force: true });
await rm(htmlPath, { force: true });

const chapters = await loadChapters(book);
if (chapters.length === 0) {
  // 장이 없는 책은 PDF 로 만들 것이 없다 — 검사·산문 검사와 달리 빌드에서는 오류다.
  console.error(`장이 없습니다 — ${book.key}: ${book.dir}`);
  process.exit(1);
}
// 출력 HTML 에서 docs/manual/ 까지의 상대 경로(항상 슬래시, 끝 슬래시 포함) — 머신에 묶이지 않는 HTML 을 위해.
const assetBase = `${path.relative(outDir, path.join(ROOT, 'docs/manual')).split(path.sep).join('/')}/`;
let html;
try {
  html = renderBook(book, chapters, await loadBoxes(), { buildDate, assetBase });
} catch (e) {
  // 렌더링 오류(깨진 장 링크·모르는 표식 키·boxes.json 형식 등)는 원인 한 줄만 보인다 — 스택은 집필자에게 소음이다.
  console.error(`빌드 실패: ${e.message.split('\n')[0]}`);
  process.exit(1);
}
await mkdir(outDir, { recursive: true });
await writeFile(htmlPath, html);

// about:blank 의 setContent 는 file 하위 리소스를 막으므로 file:// 로 연다.
let missing = [];
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
  // 웹폰트·이미지 디코딩이 끝나야 인쇄 결과가 화면과 같다.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
  });
  missing = await page.evaluate(() =>
    [...document.images].filter((img) => img.naturalWidth === 0).map((img) => img.getAttribute('src')),
  );
  if (!missing.length) {
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true });
  }
} finally {
  await browser.close();
}

// 판정은 브라우저를 닫은 뒤에: 깨진 이미지가 있으면 목록을 보이고 실패로 끝낸다.
if (missing.length) {
  console.error(`이미지를 불러오지 못했습니다(촬영을 먼저 돌린다):\n${[...new Set(missing)].map((s) => `  - ${s}`).join('\n')}`);
  process.exit(1);
}
console.log(`PDF → ${pdfPath}`);
