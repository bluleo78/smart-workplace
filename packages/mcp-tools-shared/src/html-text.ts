// src/html-text.ts — HTML 메일 본문 → 읽을 수 있는 평문(WP-353). get_mail 이 bodyText 가 비었을 때만 쓴다.
// 결과는 LLM 이 읽는 텍스트이지 HTML 로 다시 렌더링되지 않으므로 완벽한 파서는 필요 없다 — 의존성 없이 태그를 걷어내고 줄 구조만 살린다.
// 외부 발신자가 보낸 임의 HTML 을 공유 MCP 서버가 처리하므로 입력 길이에 선형이어야 한다: 닫는 표지가 없는 여는 표지(`<!--`·`<style>` 반복)가
// 있어도 "닫힘 또는 입력 끝" 으로 한 번에 끝나게 하고(브라우저도 닫히지 않은 주석·스타일은 끝까지 삼킨다), 일반 태그는 `<` 를 건너뛰지 않게 한다.

/** 이름 있는 엔티티 중 메일에서 흔한 것만. 나머지는 원문 그대로 둔다. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  bull: '•',
  copy: '©',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // 범위를 벗어난 코드포인트(fromCodePoint 가 던진다)는 원문 그대로 둔다.
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? all;
  });
}

/**
 * HTML → 평문. script·style·head·주석은 내용째 버리고, 줄바꿈 의미가 있는 태그(br·p·div·tr·li·제목)는 개행으로, 표 칸(td·th)은 공백으로 바꾼 뒤
 * 나머지 태그를 걷어낸다. 연속 공백은 한 칸, 연속 빈 줄은 한 줄로 접는다. 링크 주소(href)와 이미지는 버린다 — 본문 요지에 쓸모가 적다.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(script|style|head)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, ' ')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote|ul|ol|header|footer|section|article|pre)\s*>/gi, '\n')
    .replace(/<[^<>]*>/g, '');
  return decodeEntities(text)
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
