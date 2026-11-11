// 도움말 그림 이미지 생성의 순수 부분(WP-1504). 매뉴얼 그림 지시문을 PDF 와 똑같은 자르기·번호 표식으로 그린 PNG 를
// 도움말 패널·MCP 가 이미지 한 장으로 쓸 수 있게 미리 만들어 docs/manual/help-figures/user/ 에 커밋한다
// (웹 이미지 빌드 단계에는 Chromium 이 없어 빌드 때 그릴 수 없다 — 계획 「내가 정한 것」 1).
// 여기에는 브라우저 없이 시험할 수 있는 것만 둔다: 낡음 판정 해시, 찍을 페이지 HTML, 할 일 계획, 검사용 상태.
// Chromium 으로 찍는 일은 CLI(help-figures.mjs)가 한다.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { cropRect, renderFigure, validateFigure, FULL_WIDTH_PX, CROP_PAD_PX } from './figure.mjs';
import { esc } from './html.mjs';

// 그림 id 규칙(`<샷 id>`, 반복은 `~2`·`~3`)은 묶음 생성과 한 함수로 같게 쓴다 — 두 곳에 따로 두면 PNG 이름과 묶음의 src 가 어긋난다.
export { collectFigures } from './help-bundle.mjs';

// 표식 모양·그리는 방식(manual.css 의 .mark·.mark-box, figure.mjs 의 자리 계산, 이 파일의 페이지 배치)을 바꾸면 올린다.
// 해시에 manual.css·figure.mjs 전체를 넣지 않는 대신 이 값으로 모든 그림을 다시 만들게 한다 — PDF 문단 스타일만 고쳐도
// PNG 97장이 다시 커밋되는 일을 막으려는 것이다(계획 「내가 정한 것」 2).
export const FIGURE_IMAGE_VERSION = 1;

// PDF 본문 단 폭(인쇄 CSS px). A4 210mm - 좌우 여백 18mm x 2 = 174mm ≈ 657px(96dpi) — figure.mjs 주석과 같은 값이다.
export const COLUMN_CSS_PX = 657;

// 객체 키를 정렬해 직렬화한다. boxes.json 은 다시 찍을 때 키 순서만 바뀔 수 있어, 순서 때문에 해시가 달라지지 않게 한다.
function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * 그림 하나의 입력 해시(sha256 hex) — manifest 에 적어 두고 다음 실행·검사에서 비교해 낡은 그림을 찾는다.
 * 입력 = 원본 샷 PNG 바이트 + 그 샷의 boxes.json 항목 + 지시문의 crop·marks + FIGURE_IMAGE_VERSION.
 * alt 는 그림에 찍히지 않으므로(figcaption 을 찍지 않음) 넣지 않는다. version 은 테스트가 상수 변경을 흉내 낼 때만 넘긴다.
 */
export function figureHash({ shotBytes, shot, fig, version = FIGURE_IMAGE_VERSION }) {
  const h = createHash('sha256');
  h.update(shotBytes);
  h.update('\0');
  h.update(canonicalJson({ shot, crop: fig.crop, marks: fig.marks, version }));
  return h.digest('hex');
}

/**
 * 그림 하나를 찍을 HTML 페이지를 만든다 → { html, frameCssWidth, frameCssHeight, deviceScaleFactor }.
 * PDF 와 같은 배치를 그대로 재현한다: 단 폭(657 CSS px) 상자 안에 renderFigure 의 <figure> 를 두면 figure 폭이
 * 단 폭 × min(1, 자른 폭/1400) 이 되어 번호 원(18 CSS px)과 그림의 크기 비율이 PDF 와 같다.
 * 그 프레임을 deviceScaleFactor = max(자른 폭, 1400) / 657 로 찍으면 결과 PNG 폭이 원본 자른 폭(px)과 같아진다(「내가 정한 것」 3).
 * figcaption 은 지운다 — alt 는 묶음 데이터로 따로 싣는다. shotHref·cssHref 는 브라우저가 열 수 있는 주소(file://)다.
 */
export function figurePage(fig, boxesDoc, { shotHref, cssHref }) {
  // renderFigure 가 지시문·상자를 검사하고(문제가 있으면 던짐) PDF 와 같은 마크업을 만든다. 이미지 주소만 찍을 위치로 바꾼다.
  const figureHtml = renderFigure({ ...fig, src: shotHref }, boxesDoc).replace(/<figcaption>[\s\S]*?<\/figcaption>/, '');
  const shot = boxesDoc[fig.shotId];
  const c = cropRect(shot, fig.crop, CROP_PAD_PX, fig.shotId);
  const frameCssWidth = COLUMN_CSS_PX * Math.min(1, c.w / FULL_WIDTH_PX);
  const deviceScaleFactor = Math.max(c.w, FULL_WIDTH_PX) / COLUMN_CSS_PX;
  const html =
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">' +
    `<link rel="stylesheet" href="${esc(cssHref)}">` +
    // figure 의 위아래 기본 여백·가운데 정렬은 찍는 데 필요 없어 0 으로 둔다(.shot-frame 요소만 찍으므로 결과에는 영향이 없다).
    '<style>body{margin:0;background:#fff}.column{width:' +
    `${COLUMN_CSS_PX}px}figure.shot{margin:0}</style></head><body>` +
    `<div class="column">${figureHtml}</div></body></html>`;
  return { html, frameCssWidth, frameCssHeight: (frameCssWidth * c.h) / c.w, deviceScaleFactor };
}

/**
 * 할 일 계획 → { render, remove, fresh } (id 목록).
 * - figures: collectFigures 결과(또는 { id } 목록). hashes: id → 입력 해시. 원본 샷이 없어 해시를 못 낸 그림은 hashes 에 없고,
 *   어느 목록에도 넣지 않는다(CLI 가 건너뜀 목록으로 보이고 exit 1).
 * - render: all 이거나, PNG 가 없거나, manifest 해시가 다른 그림(문서 순서). fresh: 그대로 둘 그림.
 * - remove: 매뉴얼에서 빠졌는데 manifest 항목이나 PNG 가 남은 id(정렬).
 */
export function planFigures({ figures, manifest, hashes, existingFiles, all = false }) {
  const render = [];
  const fresh = [];
  for (const { id } of figures) {
    if (!(id in hashes)) continue;
    if (!all && existingFiles.has(id) && manifest[id]?.hash === hashes[id]) fresh.push(id);
    else render.push(id);
  }
  const live = new Set(figures.map((f) => f.id));
  const remove = [...new Set([...Object.keys(manifest), ...existingFiles])].filter((id) => !live.has(id)).sort();
  return { render, remove, fresh };
}

/**
 * 검사용 상태(Task 4 의 manual:check 가 쓴다) → { missing, stale } (문서 순서).
 * missing: PNG 가 없는 그림. stale: PNG 는 있지만 manifest 해시가 지금 입력 해시와 다르거나 manifest 항목이 없는 그림
 * (무엇으로 만들었는지 모르면 믿을 수 없다). 해시를 못 낸 그림(원본 샷 없음)은 stale 판정에서 뺀다 — 원본 문제는 다른 검사가 알린다.
 */
export function figureState({ figures, manifest, hashes, existingFiles }) {
  const missing = [];
  const stale = [];
  for (const { id } of figures) {
    if (!existingFiles.has(id)) missing.push(id);
    else if (id in hashes && manifest[id]?.hash !== hashes[id]) stale.push(id);
  }
  return { missing, stale };
}

/** manifest.json 내용 — 키 정렬·2칸 들여쓰기·끝 줄바꿈(같은 내용이면 바이트 단위로 같아 불필요한 diff 가 생기지 않는다). */
export function manifestText(manifest) {
  const sorted = {};
  for (const id of Object.keys(manifest).sort()) {
    const { hash, w, h } = manifest[id];
    sorted[id] = { hash, w, h };
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/**
 * 그림마다 지금 입력 해시를 낸다 → { hashes: id → 해시, skipped: 찍을 수 없는 그림 설명 줄 목록 }.
 * 지시문·상자에 문제가 있거나(validateFigure) 원본 샷이 없으면 해시를 내지 않고 skipped 에 넣는다.
 * 그림 생성(CLI)과 manual:check(낡음 검사)가 같은 입력으로 같은 해시를 내도록 한 곳에 둔다. manualDir 은 docs/manual 절대 경로.
 */
export async function figureInputs(figures, boxesDoc, { manualDir, book }) {
  const hashes = {};
  const skipped = [];
  for (const f of figures) {
    const shotPath = path.join(manualDir, f.fig.src);
    const [problem] = validateFigure(f.fig, boxesDoc, { book });
    if (problem) {
      skipped.push(`${f.id} (${f.file}:${f.line}) ${problem.message}`);
      continue;
    }
    if (!existsSync(shotPath)) {
      skipped.push(`${f.id} (${f.file}:${f.line}) 원본 샷이 없습니다: ${f.fig.src}`);
      continue;
    }
    hashes[f.id] = figureHash({ shotBytes: await readFile(shotPath), shot: boxesDoc[f.fig.shotId], fig: f.fig });
  }
  return { hashes, skipped };
}

/**
 * 도움말 그림 폴더의 지금 상태 → { manifest, existingFiles: PNG 가 있는 그림 id Set }. 폴더·manifest 가 없으면 비어 있다.
 */
export async function readFigureOutput(outDir) {
  const manifestPath = path.join(outDir, 'manifest.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf-8')) : {};
  const names = existsSync(outDir) ? await readdir(outDir) : [];
  const existingFiles = new Set(names.filter((n) => n.endsWith('.png')).map((n) => n.slice(0, -'.png'.length)));
  return { manifest, existingFiles };
}
