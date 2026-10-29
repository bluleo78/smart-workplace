// 그림 상자 파일(shots/<book>/boxes.json) 읽기·쓰기를 한곳에 둔다.
// 빌드·검사·촬영·샘플 가져오기가 같은 규칙(없으면 빈 문서, 깨졌으면 덮어쓰지 않음)을 쓰게 하려는 것이다.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './books.mjs';

/** 책의 boxes.json 절대 경로. */
export function boxesPath(bookKey) {
  return path.join(ROOT, 'docs/manual/shots', bookKey, 'boxes.json');
}

/** 샷 단위로 덮어쓴다 — 같은 샷의 옛 키가 남지 않고, 다시 찍지 않은 샷은 그대로 둔다. */
export function mergeBoxesDoc(prev, next) {
  return { ...prev, ...next };
}

/**
 * boxes.json 을 읽는다. 없으면(아직 촬영 전) { doc: {}, error: null }, 읽거나 해석하지 못하면 { doc: null, error: 이유 }.
 * 던지지 않고 이유를 돌려주는 것은 검사가 [boxes.json] 한 줄로 보고하고 나머지 검사를 이어 가게 하려는 것이다.
 */
export async function readBoxesDoc(file) {
  let text;
  try {
    text = await readFile(file, 'utf-8');
  } catch (e) {
    if (e.code === 'ENOENT') return { doc: {}, error: null };
    return { doc: null, error: e.message };
  }
  try {
    return { doc: JSON.parse(text), error: null };
  } catch (e) {
    return { doc: null, error: e.message };
  }
}

/**
 * next 를 기존 boxes.json 과 샷 단위로 합쳐 쓴다(다른 샷 좌표를 지우지 않게).
 * 기존 파일이 깨져 있으면 던진다 — 빈 문서로 보고 덮어쓰면 다른 샷 좌표가 조용히 사라지기 때문이다.
 */
export async function writeBoxesDoc(file, next) {
  const { doc: prev, error } = await readBoxesDoc(file);
  if (error) throw new Error(`boxes.json 을 읽지 못해 덮어쓰지 않습니다: ${file}: ${error}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(mergeBoxesDoc(prev, next), null, 2) + '\n');
}
