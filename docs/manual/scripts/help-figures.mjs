// 도움말 그림 이미지 만들기(WP-1504): 사용자 매뉴얼의 그림 지시문마다 PDF 와 같은 자르기·번호 표식을 얹은 PNG 를 만들어
// docs/manual/help-figures/user/<그림 id>.png 와 manifest.json(입력 해시·크기)에 쓴다. 결과는 커밋하고, 웹 빌드·manual:help 는 복사만 한다
// (웹 이미지 빌드 단계에는 Chromium 이 없다 — 계획 「내가 정한 것」 1).
// 사용: node docs/manual/scripts/help-figures.mjs [--all]
//   낡았거나(입력 해시가 manifest 와 다름) 없는 그림만 다시 찍고, --all 이면 전부 다시 찍는다.
//   매뉴얼에서 빠진 그림의 PNG·manifest 항목은 지운다.
//   원본 샷·boxes 항목이 없거나 지시문이 틀린 그림은 건너뛰고, 찍다가 실패한 그림은 모아 두었다가 manifest 를 쓴 뒤
//   목록을 보이며 exit 1(나머지는 만든다). 사용법 오류는 exit 2.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BOOKS, ROOT } from './lib/books.mjs';
import { boxesPath, readBoxesDoc } from './lib/boxes-file.mjs';
import { loadChapters } from './lib/chapters.mjs';
import { loadChromium, waitForPageAssets } from './lib/cli.mjs';
import {
  COLUMN_CSS_PX,
  collectFigures,
  figureInputs,
  figurePage,
  manifestText,
  planFigures,
  readFigureOutput,
} from './lib/help-figures.mjs';

// 명령줄을 읽는다. 모르는 인자는 사용법 오류로 멈춘다(오타로 전부 다시 찍거나 아무것도 안 하는 일을 막는다).
function parseArgs(argv) {
  let all = false;
  for (const a of argv) {
    if (a === '--all') all = true;
    else {
      console.error(`알 수 없는 인자: ${a} (사용: node docs/manual/scripts/help-figures.mjs [--all])`);
      process.exit(2);
    }
  }
  return { all };
}

// PNG 머리(IHDR)에서 폭·높이를 읽는다 — manifest 에 크기를 적어 웹·MCP 가 이미지를 받기 전에 자리를 잡을 수 있게 한다.
function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const { all } = parseArgs(process.argv.slice(2));
// 그림은 사용자 책만 만든다(묶음과 같은 범위 — 운영자 매뉴얼은 도움말 대상이 아니다).
const book = BOOKS.user;
const outDir = path.join(ROOT, book.help.figuresDir);
const manifestPath = path.join(outDir, 'manifest.json');
const cssPath = path.join(ROOT, 'docs/manual/styles/manual.css');

const chapters = await loadChapters(book);
const { doc: boxesDoc, error: boxesError } = await readBoxesDoc(boxesPath(book.key));
if (boxesError) {
  console.error(`boxes.json 을 읽지 못했습니다: ${boxesError}`);
  process.exit(1);
}
const figures = collectFigures(chapters);

// 그림마다 입력 해시를 낸다. 원본 샷이 없거나 지시문·상자에 문제가 있으면 찍을 수 없으므로 건너뜀 목록에 넣는다
// (manual:check 의 낡음 검사와 같은 함수 — 판정이 어긋나지 않게).
const { hashes, skipped } = await figureInputs(figures, boxesDoc, { manualDir: path.join(ROOT, 'docs/manual'), book: book.key });
const byId = new Map(figures.map((f) => [f.id, f]));

await mkdir(outDir, { recursive: true });
const { manifest, existingFiles } = await readFigureOutput(outDir);
const plan = planFigures({ figures, manifest, hashes, existingFiles, all });

// 매뉴얼에서 빠진 그림은 PNG·manifest 항목을 함께 지운다(남기면 묶음에 실리지 않는 파일이 저장소에 쌓인다).
for (const id of plan.remove) {
  await rm(path.join(outDir, `${id}.png`), { force: true });
  delete manifest[id];
}

// 찍다가 실패한 그림 — 하나가 깨져도 나머지는 계속 만들고, manifest 를 쓴 뒤 끝에 목록을 보이며 exit 1.
// (첫 실패에서 멈추면 앞서 만든 그림의 manifest 항목이 기록되지 않아 다음 실행이 같은 그림을 또 찍는다.)
const failed = [];
const settled = new Set(); // 결과(성공·실패)가 정해진 그림 — 브라우저·컨텍스트가 도중에 죽으면 나머지를 실패로 모으는 데 쓴다
if (plan.render.length) {
  let browser = null;
  let tmp = null;
  // 브라우저 띄우기·임시 폴더 만들기도 try 안에 둔다 — 둘 중 하나가 실패해도 finally 정리(이미 띄운 브라우저 닫기·임시 폴더 지우기)가 돈다.
  try {
    browser = await loadChromium().launch();
    // 임시 HTML 은 file:// 로 연다 — about:blank 의 setContent 는 file 하위 리소스(원본 샷·manual.css)를 막는다(build.mjs 와 같은 이유).
    tmp = await mkdtemp(path.join(tmpdir(), 'manual-help-figures-'));
    for (const [i, id] of plan.render.entries()) {
      const f = byId.get(id);
      const page = figurePage(f.fig, boxesDoc, {
        shotHref: pathToFileURL(path.join(ROOT, 'docs/manual', f.fig.src)).href,
        cssHref: pathToFileURL(cssPath).href,
      });
      // 그림마다 배율(DSF)이 달라 컨텍스트를 새로 연다. 뷰포트는 단 폭과 프레임 높이를 덮게 잡는다(잘림 없이 한 화면에 들어오게).
      const context = await browser.newContext({
        viewport: { width: COLUMN_CSS_PX, height: Math.max(100, Math.ceil(page.frameCssHeight) + 4) },
        deviceScaleFactor: page.deviceScaleFactor,
      });
      try {
        const htmlPath = path.join(tmp, `${id}.html`);
        await writeFile(htmlPath, page.html);
        const tab = await context.newPage();
        await tab.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
        // 웹폰트·이미지 디코딩이 끝나야 번호 글자와 화면이 PDF 와 같게 찍힌다. 원본이 깨졌으면 빈 그림 대신 실패로 알린다.
        const broken = await waitForPageAssets(tab);
        if (broken.length) throw new Error(`원본 샷을 불러오지 못했습니다: ${f.fig.src}`);
        const target = path.join(outDir, `${id}.png`);
        const buf = await tab.locator('.shot-frame').screenshot({ path: target, type: 'png' });
        manifest[id] = { hash: hashes[id], ...pngSize(buf) };
        settled.add(id);
        console.log(`[${i + 1}/${plan.render.length}] ${id}.png ${manifest[id].w}x${manifest[id].h} ${Math.round(buf.length / 1024)}KB`);
      } catch (e) {
        // 이 그림만 실패로 모으고 다음 그림으로 간다. 기존 PNG·manifest 항목은 그대로 둔다(해시가 달라 manual:check 가 낡음으로 잡는다).
        failed.push(`${id} (${f.file}:${f.line}) ${e.message}`);
        settled.add(id);
        console.log(`[${i + 1}/${plan.render.length}] ${id}.png 실패: ${e.message}`);
      } finally {
        await context.close();
      }
    }
  } catch (e) {
    // 브라우저를 띄우지 못했거나 임시 폴더·컨텍스트를 만들지 못함 — 결과가 안 정해진 그림을 모두 실패로 모은다(manifest 는 아래에서 쓴다).
    for (const id of plan.render) if (!settled.has(id)) failed.push(`${id} ${e.message}`);
  } finally {
    if (browser) await browser.close();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  }
}

// manifest 는 매번 결정적으로 다시 쓴다(키 정렬). 바뀐 것이 없으면 내용도 같다.
await writeFile(manifestPath, manifestText(manifest));

if (!plan.render.length && !plan.remove.length) console.log('다시 만들 것 없음');
console.log(
  `도움말 그림: 전체 ${figures.length} · 새로 만듦 ${plan.render.length - failed.length} · 실패 ${failed.length} · 그대로 ${plan.fresh.length} · 지움 ${plan.remove.length} · 건너뜀 ${skipped.length} → ${path.relative(ROOT, outDir)}`,
);
if (skipped.length) {
  console.log(`건너뛴 그림(원본 샷·상자를 먼저 고친다 — pnpm manual:shots / manual:check):\n${skipped.map((s) => `  - ${s}`).join('\n')}`);
}
if (failed.length) console.log(`찍지 못한 그림:\n${failed.map((s) => `  - ${s}`).join('\n')}`);
// 건너뛴 그림·실패한 그림이 하나라도 있으면 exit 1 — 나머지 그림과 manifest 는 이미 썼다.
if (skipped.length || failed.length) process.exit(1);
