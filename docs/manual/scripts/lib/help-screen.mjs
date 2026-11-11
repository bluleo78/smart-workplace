// 화면 소스의 도움말 id 정적 수집(WP-1504). 화면 요소에 붙인 `data-help="<도움말 id>"` 를 소스에서 모아
// manual:check 가 매뉴얼 절 id 와 짝을 맞춘다 — 화면이 가리키는 도움말 절이 매뉴얼에 없거나 id 를 잘못 쓰면 빌드 전에 잡으려는 것이다.
// 파서가 아닌 정규식이라 값이 글자 그대로 적힌 경우만 셀 수 있고, 변수로 넘긴 값은 「동적」으로 개수만 센다(계획 「내가 정한 것」 15).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { listSourceFiles } from './ui-strings.mjs';

/**
 * 도움말 id 를 받는 화면 속성 이름 목록. 나중에 감싸개 컴포넌트(예: `<HelpTarget helpId="…">`)를 만들면 그 속성 이름을 여기에 더한다 —
 * 속성마다 아래 다섯 가지 정적 꼴이 모두 인식되고, 그 밖의 `<속성>=` 은 동적으로 센다.
 */
export const DATA_HELP_PATTERNS = ['data-help'];

// 정규식에 넣을 수 있게 특수 문자를 탈출한다(속성 이름의 `-` 등).
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

// 속성 이름 + `=`(둘레 공백·탭 허용) 정규식 조각. 정적 꼴과 전체 등장 세기가 같은 앞부분을 써야 「동적 = 전체 − 정적」이 맞는다.
const attrEq = (attr) => `(?<![\\w-])${escapeRe(attr)}[ \\t]*=[ \\t]*`;

/**
 * 속성 하나의 정적 꼴 정규식 목록. 그룹 1 = id 값.
 *   attr="…"  ·  attr='…'(JSX 는 홑따옴표 속성도 받는다)  ·  attr={'…'}  ·  attr={"…"}  ·  attr={`…`}(`${` 없는 템플릿만 — 있으면 값이 정해지지 않으므로 동적)
 * `=` 둘레 공백(`data-help = "a.b"`)도 JSX 문법상 같은 속성이라 받는다 — 안 받으면 정적 값인데도 동적으로 세어 짝 검사가 빠진다.
 * 앞에 \b 대신 「이름 글자가 아닌 것」을 요구해 `my-data-help=` 같은 다른 속성을 잡지 않는다.
 */
function staticForms(attr) {
  const a = attrEq(attr);
  return [
    new RegExp(`${a}"([^"\\n]*)"`, 'g'),
    new RegExp(`${a}'([^'\\n]*)'`, 'g'),
    new RegExp(`${a}\\{\\s*'([^'\\\\\\n]*)'\\s*\\}`, 'g'),
    new RegExp(`${a}\\{\\s*"([^"\\\\\\n]*)"\\s*\\}`, 'g'),
    new RegExp(`${a}\\{\\s*\`((?:[^\`\\\\$]|\\$(?!\\{))*)\`\\s*\\}`, 'g'),
  ];
}

// 속성의 모든 등장(정적·동적 구분 없이) — 동적 개수 = 전체 − 정적.
const anyForm = (attr) => new RegExp(attrEq(attr), 'g');

/**
 * 오름차순 위치 목록 → 줄 번호(1부터) 목록. 소스를 한 번만 훑으며 줄바꿈을 센다 —
 * 위치마다 처음부터 세면 id 가 많은 큰 파일에서 (id 수 × 파일 길이)만큼 돈다.
 */
function linesAt(source, indexes) {
  const out = [];
  let n = 1;
  let i = 0;
  for (const index of indexes) {
    for (; i < index; i++) if (source.charCodeAt(i) === 10) n++;
    out.push(n);
  }
  return out;
}

/**
 * 소스 한 파일에서 정적 도움말 id 를 나온 순서로 뽑는다 → { ids: [{ id, line }], dynamic: 정적이 아닌 등장 수 }.
 */
export function extractDataHelp(source) {
  const found = [];
  let dynamic = 0;
  for (const attr of DATA_HELP_PATTERNS) {
    let statics = 0;
    for (const re of staticForms(attr)) {
      for (const m of source.matchAll(re)) {
        found.push({ id: m[1], index: m.index });
        statics++;
      }
    }
    dynamic += [...source.matchAll(anyForm(attr))].length - statics;
  }
  found.sort((x, y) => x.index - y.index);
  const lines = linesAt(source, found.map((f) => f.index));
  return { ids: found.map((f, k) => ({ id: f.id, line: lines[k] })), dynamic };
}

/**
 * srcDir 아래 화면 소스(.ts·.tsx, 테스트 제외 — 화면 문구 검사와 같은 범위)의 도움말 id 를 모은다
 * → { ids: [{ id, file, line }], dynamic }. file 은 base(기본 srcDir) 기준 `/` 구분 상대 경로(출력에 그대로 보인다).
 */
export async function collectDataHelp(srcDir, { base = srcDir } = {}) {
  const files = await listSourceFiles(srcDir);
  const sources = await Promise.all(files.map((f) => readFile(f, 'utf-8')));
  const ids = [];
  let dynamic = 0;
  files.forEach((full, i) => {
    const r = extractDataHelp(sources[i]);
    const file = path.relative(base, full).split(path.sep).join('/');
    for (const x of r.ids) ids.push({ id: x.id, file, line: x.line });
    dynamic += r.dynamic;
  });
  return { ids, dynamic };
}
