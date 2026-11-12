import { type LucideIcon, Sparkles } from 'lucide-react'

/**
 * AI 표식 아이콘 — 글자 없이 아이콘만 놓이는 자리(툴바·빈 상태 장식 등)에 쓴다(WP-1529).
 * 글자와 함께 놓이면 AiLabel 을 쓴다. 에이전트(주체) 자체를 나타낼 때는 Bot 이다.
 * 구현은 lucide Sparkles 를 그대로 노출 — props·타입이 같고, lucide 가 aria-hidden 을 스스로 달아 준다.
 * Sparkles 직접 import 는 린트(ai-marker/no-direct-sparkles)가 막으므로 이 모듈이 유일한 통로다.
 */
export const AiIcon: LucideIcon = Sparkles
