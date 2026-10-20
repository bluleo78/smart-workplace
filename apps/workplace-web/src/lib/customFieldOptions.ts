// 프로젝트 필드(커스텀 필드) 옵션 입력 — 설정 화면의 「옵션 (콤마 구분)」 칸과 옵션 배열 사이 변환.
// 필드 추가·편집(WP-611)이 같은 규칙을 쓰도록 한곳에 둔다.

/** 콤마로 나눈 옵션 글을 배열로 — 앞뒤 공백을 다듬고 빈 항목은 버린다. */
export function parseFieldOptions(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 옵션 배열을 편집 칸에 넣을 글로 — 「a, b, c」. */
export function formatFieldOptions(options: string[] | null | undefined): string {
  return (options ?? []).join(', ');
}
