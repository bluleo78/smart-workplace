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

/** parseIssueKey 의 역 — 둘 중 하나라도 없으면 undefined(부분 키 'WP-undefined' 를 만들지 않는다). */
export function formatIssueKey(projectKey: string | null | undefined, number: number | null | undefined): string | undefined {
  return projectKey && number != null ? `${projectKey}-${number}` : undefined;
}

/**
 * API 오류 응답 → LLM 이 읽을 수 있는 한 줄(#840). 백엔드 ErrorResponse 는 {message, errors: {필드: 사유}} 형태이며,
 * 필드 검증 오류가 있으면 함께 붙여 어떤 파라미터가 틀렸는지 드러낸다. ai-agent·workplace-mcp 가 같은 문구를 쓰도록 공유한다.
 */
export function describeApiError(status: number | undefined, data: unknown): string {
  const head = status ? `API 오류 ${status}` : 'API 오류';
  if (data && typeof data === 'object') {
    const body = data as { message?: unknown; errors?: unknown };
    const message = typeof body.message === 'string' ? body.message : '';
    const details =
      body.errors && typeof body.errors === 'object'
        ? Object.entries(body.errors as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`).join(', ')
        : '';
    if (message || details) return `${head}: ${[message, details].filter(Boolean).join(' — ')}`;
  }
  if (typeof data === 'string' && data.trim()) return `${head}: ${data.trim().slice(0, 300)}`;
  return head;
}

/** 팬아웃 단계 실패 메시지를 짧게 뽑는다 — 문자열 본문은 그대로, 객체 본문은 describeApiError 요약, 없으면 message. */
export function errText(e: unknown): string {
  const anyE = e as { response?: { status?: number; data?: unknown }; message?: string };
  if (anyE?.response?.data !== undefined) {
    return typeof anyE.response.data === 'string'
      ? anyE.response.data
      : describeApiError(anyE.response.status, anyE.response.data);
  }
  return anyE?.message ?? String(e);
}
