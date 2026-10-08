// 러너 실행 한도 도달 오류 — 턴 한도(maxTurns)·시간 한도(timeoutMs)에 걸려 중단된 경우를 일반 실행 오류와 구분한다.
// 호출자(예: 메인 AI 채팅)는 이 오류를 잡아 그때까지 모은 결과로 답을 마무리할 수 있다. 잡지 않는 호출자에게는
// 기존과 똑같이 reject 로 보이도록 Error 를 상속하고 메시지도 종전 형식을 유지한다.
export type RunnerLimitKind = 'max_turns' | 'timeout';

export class RunnerLimitError extends Error {
  readonly kind: RunnerLimitKind;

  constructor(kind: RunnerLimitKind, message: string) {
    super(message);
    this.name = 'RunnerLimitError';
    this.kind = kind;
  }
}

