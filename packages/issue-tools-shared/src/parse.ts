// src/parse.ts — issueKey 파싱과 에러 메시지 추출. 두 앱이 공유(기존 중복 제거).

/** 'WP-12' → { projectKey:'WP', number:12 } (마지막 '-숫자' 기준 분리).
 * 형식이 맞지 않으면(하이픈 없음/숫자 아님) 명확한 에러를 던진다 — 도구 레이어가 isError 로 래핑. */
export function parseIssueKey(issueKey: string): { projectKey: string; number: number } {
  const m = /^(.+)-(\d+)$/.exec(issueKey);
  if (!m) {
    throw new Error(`issueKey 형식이 올바르지 않습니다: ${issueKey}`);
  }
  return { projectKey: m[1], number: Number(m[2]) };
}

/** 팬아웃 단계 실패 메시지를 짧게 뽑는다 — axios 응답 본문 우선, 없으면 message. */
export function errText(e: unknown): string {
  const anyE = e as { response?: { data?: unknown }; message?: string };
  if (anyE?.response?.data !== undefined) {
    return typeof anyE.response.data === 'string'
      ? anyE.response.data
      : JSON.stringify(anyE.response.data);
  }
  return anyE?.message ?? String(e);
}
