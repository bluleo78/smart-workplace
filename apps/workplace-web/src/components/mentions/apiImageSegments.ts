// 코멘트 글 속 이슈 이미지 마크다운(WP-362) — 입력창 복원(bodyToDoc)·입력창 표시(RichImageNodeView)·목록 표시(IssueCommentList)가 같은 규칙을 쓴다.

/**
 * 이슈 이미지 경로 `/api/v1/projects/{키}/issue-images/{id}` — 서버 IssueBodyImageResponse.REF 와 짝.
 * 이 경로만 이미지로 다룬다: 글에 적힌 임의 `/api/v1/...` 를 보는 사람의 인증으로 요청하지 않게(IssueBodyImage 와 같은 이유).
 */
const ISSUE_IMAGE_PATH = String.raw`/api/v1/projects/([^/\s)]+)/issue-images/\d{1,19}(?!\d)`;

/** src 가 이슈 이미지 경로인지(projectKey 를 주면 그 프로젝트 것만). */
export function isIssueImageSrc(src: string | null | undefined, projectKey?: string): boolean {
  const m = src ? new RegExp(`^${ISSUE_IMAGE_PATH}$`).exec(src) : null;
  return m !== null && (projectKey === undefined || m[1] === projectKey);
}

/**
 * 이슈 이미지 마크다운 `![이름](/api/v1/projects/{키}/issue-images/{id})`. group(1)=이름, group(2)=경로, group(3)=프로젝트 키.
 * 이름의 [ ] 는 저장 시 imageMarkdown 이 미리 지운다. 전역 플래그라 exec 로 직접 쓰지 말고 source 로 새 정규식을 만들거나
 * matchAll 로 쓴다(lastIndex 공유 방지).
 */
export const API_IMAGE_MD = new RegExp(String.raw`!\[([^\]\n]*)\]\((${ISSUE_IMAGE_PATH})\)`, 'g');

export type ImageSegment = { type: 'text'; value: string } | { type: 'image'; src: string; alt: string };

/** projectKey 의 이미지 마크다운만 — 다른 프로젝트 경로는 화면에 그리지 못하므로 글자로 남긴다. */
function matchesOf(text: string, projectKey: string) {
  return [...text.matchAll(API_IMAGE_MD)].filter((m) => m[3] === projectKey);
}

/**
 * 글을 텍스트·이미지 조각으로 나눈다(이 프로젝트 이슈 이미지만). 이미지는 목록에서 블록으로 그려지므로, 저장 형식상
 * 이미지 앞뒤에 붙은 줄바꿈 하나씩은 빼서 빈 줄이 생기지 않게 한다(줄바꿈 보존 렌더 whitespace-pre-wrap 기준).
 */
export function splitApiImages(text: string, projectKey: string): ImageSegment[] {
  const out: ImageSegment[] = [];
  let last = 0;
  for (const m of matchesOf(text, projectKey)) {
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

/** 글에 든 서로 다른 이미지 수 — 삭제 확인창 안내용(같은 이미지를 두 번 넣어도 하나). */
export function countApiImages(text: string, projectKey: string): number {
  return new Set(matchesOf(text, projectKey).map((m) => m[2])).size;
}

/** 이미지 마크다운을 '[이미지]' 로 줄인 글 — 삭제 확인창 미리보기처럼 짧게 보여 줄 때. */
export function withImagePlaceholders(text: string, projectKey: string): string {
  return text.replace(API_IMAGE_MD, (whole, _alt, _src, key) => (key === projectKey ? '[이미지]' : whole));
}
