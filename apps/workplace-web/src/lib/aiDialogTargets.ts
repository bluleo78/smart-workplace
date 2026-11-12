// AI 답의 「창 열기」 단추가 열 수 있는 대화상자의 허용 목록(WP-1511).
// AI 가 답에 적은 id 라도 여기 없으면 단추를 그리지 않는다 — 단추는 화면이 미리 정한 목록 안의 창만 연다.
// 또 이 목록 안의 id 도, 지금 화면이 열 수 있다고 등록(AiDialogTargets)했을 때만 단추가 된다.

/** 허용 목록 — id 는 도움말 절 id 와 같은 꼴, label 은 단추 글(`<label> 창 열기`)과 화면 참고(help.dialogs)에 쓴다. */
export const AI_DIALOG_TARGETS = {
  'agent.run.repo.token': { label: '저장소 토큰 넣기' },
  'agent.run.account': { label: 'AI 계정 연결' },
  'agents.accounts.add': { label: '계정 추가' },
} as const;

/** 허용 목록의 id. */
export type AiDialogTargetId = keyof typeof AI_DIALOG_TARGETS;

/** 문자열이 허용 목록의 id 인가 — 상속 속성(toString 등)은 허용하지 않도록 own 속성만 본다. */
export function isAiDialogTargetId(id: string): id is AiDialogTargetId {
  return Object.hasOwn(AI_DIALOG_TARGETS, id);
}

/** 창 열기 단추 글 — `<목록 라벨> 창 열기`. */
export function aiDialogButtonText(id: AiDialogTargetId): string {
  return `${AI_DIALOG_TARGETS[id].label} 창 열기`;
}
