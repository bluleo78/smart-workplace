// 새 메일 AI 초안(WP-576) 규칙 — 제목을 언제 AI 에 맡기고 언제 지키는지, [되돌리기]가 어느 모습으로 돌아가는지.
// useMailAiDraft(화면 상태)가 쓰는 순수 함수라 vitest(node)로 지킨다.

/** 지시 상한 — 서버 MailComposeDraftRequest.instruction @Size(max=4000) 과 같은 값. */
export const COMPOSE_DRAFT_INSTRUCTION_MAX = 4000;

/** 지금 제목이 지난 AI 제목 그대로인가 — 사용자가 손대지 않은 AI 제목은 사용자 제목으로 보지 않는다. */
function isUntouchedAiSubject(subject: string, aiSubject: string | null): boolean {
  return aiSubject != null && subject === aiSubject;
}

/**
 * 요청에 실을 제목. 서버는 요청 제목이 비었을 때만 제목을 만들어 주므로(응답 subject),
 * 비었거나 지난 AI 제목 그대로면 null 로 보내 [다시 쓰기] 때 새 초안에 맞는 제목을 다시 받는다. 사용자가 쓴 제목은 그대로 참고로 보낸다.
 */
export function composeDraftRequestSubject(subject: string, aiSubject: string | null): string | null {
  if (subject.trim() === '' || isUntouchedAiSubject(subject, aiSubject)) return null;
  return subject;
}

/**
 * 생성 결과를 반영할 때의 제목과 "AI 가 채운 제목" 기억. 판정은 응답이 도착한 때의 제목(now)으로 한다 —
 * 생성 중 사용자가 제목을 쓰거나 고쳤으면(now ≠ 요청 때 제목) 그 제목을 지키고 AI 제목은 버린다.
 * - 요청 때와 같고, 비었거나 지난 AI 제목 그대로이며, 응답 subject 가 있으면 그 제목으로 바꾸고 기억한다.
 * - 그 밖엔 지금 제목을 지킨다 — 사용자가 직접 쓴 제목은 덮어쓰지 않는다.
 */
export function resolveDraftSubject({
  now,
  atRequest,
  aiSubject,
  resultSubject,
}: {
  /** 응답이 도착한 때의 제목 */
  now: string;
  /** 요청을 보낼 때 캡처한 제목 */
  atRequest: string;
  /** 지난 생성에서 AI 가 채운 제목(없으면 null) */
  aiSubject: string | null;
  /** 응답 subject */
  resultSubject: string | null;
}): { subject: string; aiSubject: string | null } {
  const untouchedAi = isUntouchedAiSubject(now, aiSubject);
  // 생성 중 사용자가 제목을 바꾸지 않았고, 비어 있거나 AI 가 넣은 그대로면 새 AI 제목으로 바꾼다. 그 밖엔 지금 제목을 지킨다.
  const replaceable = now === atRequest && (now.trim() === '' || untouchedAi);
  if (replaceable && resultSubject) return { subject: resultSubject, aiSubject: resultSubject };
  return { subject: now, aiSubject: untouchedAi ? aiSubject : null };
}

/**
 * [되돌리기] 때의 제목 — 지금 제목이 AI 가 넣은 제목 그대로일 때만 생성 직전 제목으로 돌린다.
 * 사용자가 그 뒤 제목을 고쳤거나 AI 가 제목을 넣지 않았으면 지금 제목을 그대로 둔다(본문만 되돌린다).
 */
export function undoDraftSubject(now: string, aiSubject: string | null, beforeGenerate: string): string {
  return isUntouchedAiSubject(now, aiSubject) ? beforeGenerate : now;
}

/**
 * 다시 시도해도 결과가 같은 영구 사유(서버 errors.code) — 계정 AI 꺼짐·비서 미설정.
 * 이때 패널은 [다시 시도] 대신 [닫기]만 보이고, 계정 목록을 새로 받아 진입점이 사라지게 한다. 코드 없는 503(일시 불가)·502 는 재시도한다.
 */
export const PERMANENT_COMPOSE_DRAFT_ERRORS: ReadonlySet<string> = new Set(['AI_DISABLED', 'ASSISTANT_NOT_CONFIGURED']);

/**
 * [되돌리기] 대상 — 손대지 않은 AI 초안을 다시 쓰는 중이면(filled) 맨 처음(AI 이전) 모습을 그대로 두고,
 * 아니면 이번 생성 직전 모습을 새 대상으로 삼는다.
 */
export function nextUndoSnapshot<T>(current: T | null, filled: boolean, beforeGenerate: T): T {
  return filled && current != null ? current : beforeGenerate;
}
