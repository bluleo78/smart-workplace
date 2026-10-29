#!/usr/bin/env node
/**
 * 소개서 촬영본을 사용자 매뉴얼 샘플 그림으로 가져온다 — 샘플 전용, WP-1196 에서 삭제.
 *
 *   node docs/manual/scripts/import-intro-shots.mjs
 *
 * 왜: 매뉴얼 전용 운영 테넌트(WP-1194)가 생기기 전이라, 04장 샘플의 쪽 구성·그림 가독성을 확인하려고
 * 가상 회사(누리커머스)·격리 스택에서 찍은 소개서 그림(docs/intro/deck/shots)을 빌려 쓴다.
 * 테넌트가 생기면 WP-1196 이 capture.mjs 장면으로 다시 찍고 이 스크립트를 지운다.
 *
 * 하는 일: 소개서 boxes.js(window.SHOT_BOXES = {...})를 읽어 아래 5개 샷을 shots/user/ai-collaboration-{1..5}.png
 * 로 복사하고, boxes.json 에 { w:2880, h:1620, boxes:<그 샷의 키 그대로> } 로 합쳐 쓴다(다른 샷은 그대로 둔다).
 * 상자 값은 이미지 경계 [0,w]×[0,h] 로 잘라 넣는다 — 소개서 촬영이 화면 밖까지 이어진 요소(ai-issue:result,
 * 아래로 2071px 까지)의 크기를 그대로 기록해, 그대로 두면 표식이 자르기 영역 밖이라는 빌드 오류가 난다.
 * 키 이름은 바꾸지 않는다.
 */
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT } from './lib/books.mjs';
import { boxesPath, writeBoxesDoc } from './lib/boxes-file.mjs';
import { clampBox } from './lib/capture-kit.mjs';

// 소개서 샷 id → 매뉴얼 그림 id. 순서가 곧 ai-collaboration-N 번호다.
const SOURCES = ['ai-tasks', 'assignee', 'ai-issue', 'ai-issue-history', 'ai-panel'];
const W = 2880;
const H = 1620;

const srcDir = path.join(ROOT, 'docs/intro/deck/shots');
const outDir = path.join(ROOT, 'docs/manual/shots/user');

// boxes.js 는 브라우저용 전역 대입 스크립트라 import 할 수 없다 — 빈 window 를 둔 샌드박스에서 실행해 값만 꺼낸다.
const sandbox = { window: {} };
vm.runInNewContext(await readFile(path.join(srcDir, 'boxes.js'), 'utf-8'), sandbox);
const intro = sandbox.window.SHOT_BOXES;
if (!intro) throw new Error('boxes.js 에서 window.SHOT_BOXES 를 찾지 못했다');

// 상자를 이미지 경계 안으로 자른다(촬영 도구와 같은 clampBox). 경계 밖으로 완전히 나간 상자는 쓸 수 없으므로 오류.
function clampOrThrow(b, key) {
  const c = clampBox(b, W, H);
  if (!c) throw new Error(`상자가 이미지 밖에 있다: ${key}`);
  return c;
}

await mkdir(outDir, { recursive: true });
const doc = {};
for (const [i, src] of SOURCES.entries()) {
  const boxes = intro[src];
  if (!boxes) throw new Error(`소개서 boxes.js 에 ${src} 가 없다`);
  const id = `ai-collaboration-${i + 1}`;
  await copyFile(path.join(srcDir, `${src}.png`), path.join(outDir, `${id}.png`));
  doc[id] = {
    w: W,
    h: H,
    boxes: Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, clampOrThrow(b, `${src}:${k}`)])),
  };
  console.log(`  ${src}.png → ${id}.png (${Object.keys(boxes).join(', ')})`);
}
// 다른 샷(촬영 장면이 찍은 것)이 지워지지 않도록 기존 boxes.json 과 샷 단위로 합친다(깨진 파일은 덮어쓰지 않고 던진다).
await writeBoxesDoc(boxesPath('user'), doc);
console.log(`boxes.json → ${Object.keys(doc).length}개 샷`);
