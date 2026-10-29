// 매뉴얼 마크다운 줄 단위 도구: 코드 펜스 판정, 산문 줄 추출, 이모지 검사, 장 링크 찾기.
// 검사(check)·산문(prose)·렌더(render)가 같은 펜스 규칙을 쓰도록 한 곳에 둔다.

// 펜스 줄: 들여쓰기 뒤 ``` 또는 ~~~ 가 셋 이상. 그룹 1 은 펜스 문자열(닫는 펜스가 여는 것과 같은 문자인지 보려고).
const FENCE = /^\s*(`{3,}|~{3,})/;

/**
 * 줄마다 코드 블록에 속하는지(true) 돌려준다. 여닫는 펜스 줄 자체도 코드로 본다.
 * 닫기는 연 것과 같은 문자(` 또는 ~)이고 길이가 같거나 긴 펜스만 인정한다 — ~~~ 블록 안의 ``` 예시가 블록을 닫지 않게.
 */
export function codeLineMask(lines) {
  let open = null; // 열린 펜스 문자열(없으면 null)
  return lines.map((line) => {
    const m = FENCE.exec(line);
    if (open === null) {
      if (m) open = m[1];
      return Boolean(m);
    }
    if (m && m[1][0] === open[0] && m[1].length >= open.length) open = null;
    return true;
  });
}

// 코드 펜스 밖의 줄만 (줄 번호, 내용) 으로 돌려준다. 이모지·그림·굵게 검사가 코드 예시를 건드리지 않게 한다.
export function proseLines(raw) {
  const lines = raw.split('\n');
  const code = codeLineMask(lines);
  const out = [];
  lines.forEach((line, i) => {
    if (!code[i]) out.push([i + 1, line]);
  });
  return out;
}

// 이모지 정규식: smart-dcim check-routes.py 와 같은 범위(그림문자 전반·기타 기호/딩뱃·화살표/도형 보충·표현 선택자).
const EMOJI = /[\u{1F000}-\u{1FAFF}☀-➿⬀-⯿️]/u;
// 조판에 쓰는 기호는 허용한다.
const ALLOWED_SYMBOLS = new Set('→←↑↓▸·—');

// 줄에서 허용 목록 밖의 이모지가 있는지.
export function hasEmoji(line) {
  return [...line].some((ch) => EMOJI.test(ch) && !ALLOWED_SYMBOLS.has(ch));
}

// 다른 장으로 가는 링크 `[글](NN-slug.md)` 또는 `[글](NN-slug.md#절)`. 이미지(![..])는 제외한다. 그룹: 1=글, 2=장 파일명.
const CHAPTER_LINK = /(?<!!)\[([^\]]+)\]\((\d\d-[a-z0-9-]+\.md)(?:#[^)]*)?\)/g;

/** 줄의 장 링크를 fn(글, 장 파일명) 의 반환값으로 바꾼다. 렌더가 `#ch-<slug>` 앵커로 바꿀 때 쓴다. */
export function replaceChapterLinks(line, fn) {
  return line.replace(CHAPTER_LINK, (_, text, target) => fn(text, target));
}

/** 줄의 장 링크가 가리키는 장 파일명 목록. 검사가 책에 없는 장을 찾을 때 쓴다(렌더와 같은 정규식). */
export function chapterLinkTargets(line) {
  return [...line.matchAll(CHAPTER_LINK)].map((m) => m[2]);
}

// 저장소 파일로 가는 상대 링크 `[글](../…)`. 이미지(![..])는 제외한다. 그룹 1=글.
const REPO_LINK = /(?<!!)\[([^\]]+)\]\((?:\.\.\/)+[^)]*\)/g;

/** 저장소 파일 링크를 글만 남기고 지운다(저장소 파일은 PDF 에서 열 수 없어 의미가 없다). */
export function stripRepoLinks(line) {
  return line.replace(REPO_LINK, '$1');
}
