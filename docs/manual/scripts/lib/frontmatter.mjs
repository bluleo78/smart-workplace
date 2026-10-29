// 매뉴얼 마크다운의 프론트매터 파서와 검증기.
// 외부 YAML 라이브러리 없이 "키: 값" 한 줄 형식만 지원한다 — 값이 [ 로 시작하면 쉼표 배열, part 만 숫자면 number.
// slug·title 등은 숫자처럼 보여도(slug: 404) 문자열로 둔다 — 파일명과 비교하고 앵커로 쓰는 값이라서다.

import { hasParts } from './books.mjs';

const AUDIENCES = ['member', 'admin', 'operator'];
// 맨 앞 `---` 프론트매터 블록. 그룹 1 = 블록 안쪽.
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
// 숫자로 바꾸는 키. 그 밖의 키는 숫자처럼 보여도 문자열이다.
const NUMERIC_KEYS = new Set(['part']);

/** 파일 맨 앞 `---` 블록을 meta 로, 나머지를 body 로 나눈다. 프론트매터가 없으면 meta 는 빈 객체. */
export function parseFrontmatter(raw) {
  const m = raw.match(FRONTMATTER);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue; // 들여쓴 줄·주석 등은 무시 (여러 줄 값은 validate 가 따로 잡는다)
    const [, key, valRaw] = kv;
    const val = valRaw.trim();
    if (val.startsWith('[')) {
      const inner = val.replace(/^\[/, '').replace(/\]\s*$/, '').trim();
      meta[key] = inner === '' ? [] : inner.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (NUMERIC_KEYS.has(key) && /^-?\d+(\.\d+)?$/.test(val)) {
      meta[key] = Number(val);
    } else {
      meta[key] = val;
    }
  }
  return { meta, body: raw.slice(m[0].length) };
}

/**
 * 프론트매터 오류 메시지 목록을 돌려준다(빈 배열 = 통과).
 * raw 는 원문 전체 — 파싱 결과만으로는 여러 줄 YAML(`routes:` 다음 줄 `- /a`)을 알아볼 수 없어 함께 받는다.
 */
export function validateFrontmatter(meta, { file, book, raw = '' }) {
  const errors = [];

  if (!meta.slug) errors.push(`${file}: slug 가 없습니다`);
  else {
    // 파일명 `NN-slug.md` 에서 번호 접두와 확장자를 뗀 값이 slug 와 같아야 한다(링크 해석 기준).
    const expected = file.replace(/^.*\//, '').replace(/^\d+-/, '').replace(/\.md$/, '');
    if (meta.slug !== expected) errors.push(`${file}: slug(${meta.slug})가 파일명(${expected})과 다릅니다`);
  }
  if (!meta.title) errors.push(`${file}: title 이 없습니다`);

  if (hasParts(book)) {
    if (typeof meta.part !== 'number') errors.push(`${file}: part(숫자)가 필요합니다`);
    else if (!(meta.part in book.parts)) errors.push(`${file}: part(${meta.part})가 책 설정에 없습니다`);
  }

  if (!Array.isArray(meta.audience) || meta.audience.length === 0) {
    errors.push(`${file}: audience 는 [member, admin] 형식의 배열이어야 합니다`);
  } else {
    for (const a of meta.audience) {
      if (!AUDIENCES.includes(a)) errors.push(`${file}: 알 수 없는 audience 값 ${a} (허용: ${AUDIENCES.join(', ')})`);
    }
  }

  // routes 는 한 줄 대괄호만 허용: `routes:` 뒤가 비어 있으면 여러 줄 YAML 로 본다.
  // 프론트매터 블록 안에서만 본다 — 본문에 `routes:` 로 시작하는 줄이 있어도 오류가 아니다.
  const block = raw.match(FRONTMATTER)?.[1] ?? '';
  if (/^routes:\s*$/m.test(block)) errors.push(`${file}: routes 는 한 줄 대괄호 배열로 써야 합니다 (예: routes: [/a, /b])`);
  else if (meta.routes !== undefined && !Array.isArray(meta.routes)) errors.push(`${file}: routes 는 한 줄 대괄호 배열이어야 합니다`);

  return errors;
}

/**
 * 장 목록(파일 순서)에서 부 번호가 앞 장보다 작아지는 곳을 찾아 메시지 목록으로 돌려준다(빈 배열 = 통과).
 * 부 속지는 부가 바뀔 때마다 그리므로, 거꾸로 가면 같은 부 속지가 두 번 나오고 목차가 어긋난다.
 * part 가 숫자가 아닌 장은 건너뛴다(그 오류는 validateFrontmatter 가 따로 보고한다).
 */
export function partOrderErrors(chapters) {
  const errors = [];
  let prev;
  for (const ch of chapters) {
    const part = ch.meta.part;
    if (typeof part !== 'number') continue;
    if (prev !== undefined && part < prev) errors.push(`${ch.file} part ${part} 이 앞 장(part ${prev})보다 작습니다`);
    prev = Math.max(prev ?? part, part);
  }
  return errors;
}
