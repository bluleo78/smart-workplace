// 앱 소스에서 화면에 보이는 한글 문구를 모은다. 이 앱은 i18n 이 없어 문구가 컴포넌트에 직접 들어 있으므로 소스를 훑는다.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const HANGUL = /[ㄱ-ㆎ가-힣]/;

// 공백 정규화(연속 공백 하나, 앞뒤 제거) + NFC. 매뉴얼 본문과 같은 형태로 비교하려는 것.
// 산문 검사(prose-rules)도 굵게 문구를 이 함수로 정규화한다 — 양쪽 규칙이 어긋나지 않게 한 곳에 둔다.
export const norm = (s) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

/**
 * 소스 문자열에서 한글을 포함한 화면 문구 후보를 뽑는다.
 * (a) '…'·"…" 리터럴 (b) 템플릿 리터럴의 ${…} 를 뺀 정적 조각 (c) JSX 텍스트(> 와 < 사이, {…} 는 경계).
 * 파서가 아닌 정규식이라 주석·정규식 안의 문자열도 섞일 수 있다 — 대조용 넉넉한 집합이므로 허용한다.
 */
export function extractUiStrings(source) {
  const out = [];
  const add = (s) => {
    const n = norm(s);
    if (n && HANGUL.test(n)) out.push(n);
  };
  for (const m of source.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) add(m[1] ?? m[2]);
  for (const m of source.matchAll(/`((?:[^`\\]|\\.)*)`/g)) for (const part of m[1].split(/\$\{[^}]*\}/)) add(part);
  for (const m of source.matchAll(/>([^<>]+)</g)) for (const part of m[1].split(/\{[^}]*\}/)) add(part);
  return out;
}

// 테스트·목 파일은 화면 문구가 아니다.
const isExcluded = (rel) => /\.test\.[tj]sx?$/.test(rel) || /(^|\/)(test|__tests__)\//.test(rel);

/** srcDir 아래 .ts·.tsx 의 화면 문구를 모두 모아 Set 으로 돌려준다. */
export async function collectUiStrings(srcDir) {
  const entries = await readdir(srcDir, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => path.join(e.parentPath ?? e.path, e.name))
    .filter((full) => !isExcluded(path.relative(srcDir, full).split(path.sep).join('/')));
  // 파일 수가 많아(수백 개) 차례로 읽으면 느리므로 한꺼번에 읽는다. 결과는 집합이라 순서와 무관하다.
  const sources = await Promise.all(files.map((f) => readFile(f, 'utf-8')));
  return new Set(sources.flatMap(extractUiStrings));
}
