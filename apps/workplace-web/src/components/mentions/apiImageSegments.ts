// 코멘트 글 속 인증 이미지 마크다운(WP-362) — 입력창 복원(bodyToDoc)과 목록 표시(IssueCommentList)가 같은 규칙을 쓴다.

/**
 * 본문 속 인증 이미지 마크다운 `![이름](/api/v1/...)`. 앱 API 경로만 이미지로 본다 — 사용자가 평문으로 쓴
 * 임의 `![..](..)` 를 이미지로 바꾸지 않게. 이름의 [ ] 는 저장 시 imageMarkdown 이 미리 지운다.
 * 전역 플래그라 exec 로 직접 쓰지 말고 source 로 새 정규식을 만들거나 matchAll 로 쓴다(lastIndex 공유 방지).
 */
export const API_IMAGE_MD = /!\[([^\]\n]*)\]\((\/api\/v1\/[^\s)]+)\)/g;

export type ImageSegment = { type: 'text'; value: string } | { type: 'image'; src: string; alt: string };

/**
 * 글을 텍스트·이미지 조각으로 나눈다. 이미지는 목록에서 블록으로 그려지므로, 저장 형식상 이미지 앞뒤에 붙은
 * 줄바꿈 하나씩은 빼서 빈 줄이 생기지 않게 한다(줄바꿈 보존 렌더 whitespace-pre-wrap 기준).
 */
export function splitApiImages(text: string): ImageSegment[] {
  const out: ImageSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(API_IMAGE_MD)) {
    const at = m.index ?? 0;
    let before = text.slice(last, at);
    if (before.endsWith('\n')) before = before.slice(0, -1);
    if (before) out.push({ type: 'text', value: before });
    out.push({ type: 'image', src: m[2], alt: m[1] });
    last = at + m[0].length;
    if (text[last] === '\n') last += 1;
  }
  const rest = text.slice(last);
  if (rest) out.push({ type: 'text', value: rest });
  return out;
}

/** 글에 든 이미지 수 — 삭제 확인창 안내용. */
export function countApiImages(text: string): number {
  return [...text.matchAll(API_IMAGE_MD)].length;
}

/** 이미지 마크다운을 '[이미지]' 로 줄인 글 — 삭제 확인창 미리보기처럼 짧게 보여 줄 때. */
export function withImagePlaceholders(text: string): string {
  return text.replace(API_IMAGE_MD, '[이미지]');
}
