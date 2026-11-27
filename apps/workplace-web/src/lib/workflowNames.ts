// 워크플로우 결과·출력의 표시 이름 해석(WP-2158) — 서버(WorkflowDisplayNames)와 같은 규칙을 한 곳에 둔다.
// 왜: 정의 파일의 결과·출력 key 는 영문 식별자라 사람에게는 이름(name)을 보인다. 서버가 풀어 주는 값(배너·이동 기록)도
// 옛 서버 응답엔 없을 수 있어 모든 화면이 이 함수를 거친다 — 모델 JSON 처럼 원본 name 만 오는 곳도 같다. 기본 이름 표는 이 파일 한 곳 —
// 국제화(다국어) 때는 이 함수만 넓힌다.

/** 이름이 없을 때 쓰는 결과 기본 이름 — 질문 경로 예약 결과. */
const DEFAULT_OUTCOME_NAMES: Record<string, string> = {
  ask: '질문',
  answered: '답변',
  // 복구 조치가 남기는 결과 key(서버 WorkflowRecoveryService.RECOVER_OUTCOME) — 사람에게는 「조치」
  _recover: '조치',
}

/** 비어 있지 않은(공백만 아닌) 이름이면 그 이름, 아니면 null. */
function usable(name?: string | null): string | null {
  return name != null && name.trim() !== '' ? name : null
}

/** 결과 표시 이름 — 비어 있지 않은 name → 기본 이름(ask·answered) → key. */
export function outcomeDisplayName(key: string, name?: string | null): string {
  return usable(name) ?? DEFAULT_OUTCOME_NAMES[key] ?? key
}

/** 출력 표시 이름 — 비어 있지 않은 name → key. */
export function outputDisplayName(key: string, name?: string | null): string {
  return usable(name) ?? key
}
