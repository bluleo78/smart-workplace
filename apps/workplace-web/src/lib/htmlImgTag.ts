// HTML 문자열 안 <img> 태그를 정규식으로 찾을 때 쓰는 조각 — 작성창 본문(붙여 넣은 이미지·서명 이미지)의 src 를 문자열 그대로 바꾼다.
// DOM 으로 다시 직렬화하지 않는 까닭: 임시저장·발송 본문을 글자 그대로 두어야 바뀜 판정·서버 비교가 흔들리지 않는다.
// 속성 값 안의 `>`(Outlook 서명의 alt="Logo > Co" 등)에서 태그가 끝난 것으로 잘못 보지 않도록, 따옴표로 묶인 값은 통째로 건너뛴다.

/** `<img` 부터 src 속성 바로 앞(공백 포함)까지 — 따옴표 안의 `>`·`src=` 는 태그 끝·속성으로 보지 않는다. */
const IMG_TAG_BEFORE_SRC = String.raw`<img\b(?:[^>"']|"[^"]*"|'[^']*')*?\s`;

/** `<img …>` 태그 하나 전체 — 따옴표 안의 `>` 를 건너뛴다. */
export const IMG_TAG = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/g;

/**
 * `<img>` src(큰따옴표)가 주어진 경로 모양인 것을 찾는 정규식 — 1: 앞부분, 2: id, 3: 닫는 따옴표.
 * pathPattern 은 숫자 id 를 잡는 그룹 하나만 둔 정규식 조각이다(예: String.raw`/api/v1/files/(\d+)/content`).
 * 붙여 넣은 이미지·서명 이미지가 같은 규칙(따옴표 값 건너뛰기)으로 찾고 바꾸도록 여기서 만든다.
 */
export function imgSrcIdPattern(pathPattern: string): RegExp {
  return new RegExp(`(${IMG_TAG_BEFORE_SRC}src=")${pathPattern}(")`, 'g');
}

/** pattern(imgSrcIdPattern)에 맞는 <img> 의 id — 처음 나온 순서, 중복 없음. */
export function imgSrcIds(pattern: RegExp, html: string): number[] {
  const ids: number[] = [];
  for (const m of html.matchAll(pattern)) {
    const id = Number(m[2]);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** pattern(imgSrcIdPattern)에 맞는 <img> src 를 fn(id) 로 바꾼다. fn 이 null 이면 그 태그는 그대로 둔다. 나머지 글자는 건드리지 않는다. */
export function replaceImgSrcIds(pattern: RegExp, html: string, fn: (id: number) => string | null): string {
  return html.replace(pattern, (all, head: string, id: string, tail: string) => {
    const next = fn(Number(id));
    return next == null ? all : `${head}${next}${tail}`;
  });
}
