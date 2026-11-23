// 처리 이력의 실행 주체 표기(WP-1825) — 이름, AGENT(AI)면 이름 옆에 Bot 표식(WP-1529 에이전트 행위자 규칙).
import { Bot } from 'lucide-react'

import type { AiRunActor } from '@/api/aiStatus'

import { actorText } from './aiStatusHistoryModel'

/** 실행 주체 이름. AGENT 면 색만으로 구분하지 않도록 Bot 아이콘을 이름 앞에 붙인다(표·카드·시트 공용). */
export function AiStatusActor({ actor }: { actor: AiRunActor | null }) {
  const isAgent = actor?.type === 'AGENT'
  return (
    <span className="inline-flex items-center gap-1">
      {isAgent && <Bot className="size-3 shrink-0 text-ai-accent" aria-hidden data-testid="ai-actor-bot" />}
      {actorText(actor)}
    </span>
  )
}
