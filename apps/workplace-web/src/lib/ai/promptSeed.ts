// AI 입력창 대기 프롬프트(WP-414) — 화면(설정 가이드 등)이 「AI 에게 묻기」로 패널을 열며 입력창에 채울 문구.
// 입력창 값은 AIChatPanel 로컬 state 이고 패널은 닫히면 언마운트되므로, AIAssistantProvider 가 seed 로 들고 있다가 열린 패널이 한 번 소비한다.

/** 대기 문구 — askWithPrompt 마다 새 객체라 같은 문구를 다시 물어도 패널이 변화로 감지한다. */
export interface PromptSeed {
  text: string;
}

/**
 * 프롬프트를 입력창에 반영할 값 — 이미 쓰던 초안(공백 아닌 글)이 있으면 덮지 않고 초안을 그대로 둔다(WP-414 Review Focus 5).
 */
export function applyPromptSeed(draft: string, text: string): string {
  return draft.trim() ? draft : text;
}
