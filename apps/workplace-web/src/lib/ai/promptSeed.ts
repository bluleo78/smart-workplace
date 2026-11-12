// AI 입력창 대기 프롬프트(WP-414) — 화면(설정 가이드 등)이 「AI 에게 묻기」로 패널을 열며 입력창에 채울 문구.
// 입력창 값은 AIChatPanel 로컬 state 이고 패널은 닫히면 언마운트되므로, AIAssistantProvider 가 seed 로 들고 있다가 열린 패널이 한 번 소비한다.
// WP-1511: 도움말의 「AI에게 묻기」는 문구를 바로 보내게(send) 하고, 도움말 문맥(help)을 함께 넘긴다 —
// 도움말이 닫혀도(휴대폰 시트) 보던 절·검색어가 첫 전송의 화면 참고에 실리게 하려는 것이다.
import { attachHelp } from '@/lib/aiScreenContext/common';
import type { AiHelpContext, AiScreenContext } from '@/types/aiScreenContext';

/** 대기 문구 — askWithPrompt 마다 새 객체라 같은 문구를 다시 물어도 패널이 변화로 감지한다. */
export interface PromptSeed {
  text: string;
  /** true 면 입력창에 채우지 않고 바로 보낸다(보낼 수 있을 때만 — 막혀 있으면 채우기만). */
  send?: boolean;
  /** 넘겨받을 도움말 문맥 — buildHelpContext 가 자른 값 그대로(비밀 칸은 { name, secret: true }). */
  help?: AiHelpContext | null;
}

/**
 * 프롬프트를 입력창에 반영할 값 — 이미 쓰던 초안(공백 아닌 글)이 있으면 덮지 않고 초안을 그대로 둔다(WP-414 Review Focus 5).
 */
export function applyPromptSeed(draft: string, text: string): string {
  return draft.trim() ? draft : text;
}

/**
 * 화면 참고에 넘겨받은 도움말을 얹는다 — 지금 화면 참고에 이미 help 가 있으면(도움말이 열려 있음) 그 값이 최신이라 그대로 둔다.
 * 화면 참고가 없으면(휴대폰에서 도움말만 닫힌 뒤 등) 절·검색어가 있을 때만 「도움말」 문맥을 만든다 — 스토어(store.recompute)와 같은 규칙(attachHelp).
 */
export function withCarriedHelp(ctx: AiScreenContext | null, help: AiHelpContext | null | undefined): AiScreenContext | null {
  return ctx?.help ? ctx : attachHelp(ctx, help);
}
