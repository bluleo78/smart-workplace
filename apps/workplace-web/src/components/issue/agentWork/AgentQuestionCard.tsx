// 이슈 상세 질문 카드(WP-377) — AI 구성원이 이슈 채팅에 질문을 남기고 답변을 기다릴 때만 본문 위에 띄운다.
// 기존 AI 콘텐츠 아우라(좌측 보더 + 틴트)와 같은 모양이라 AI 가 보낸 내용임이 드러나고, 답은 이슈 채팅에서 한다.
import { MessageSquare } from 'lucide-react';

import { AiLabel } from '@/components/ai/AiLabel';
import { AI_CONTENT_CONTAINER_CLASS } from '@/components/ai/aiMarker';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AgentWorkView } from '@/types/issue';

/**
 * 질문 카드 — 라벨 「{이름}의 질문 · 답변 필요」 + 최근 보고(질문) + 「채팅에서 답하기」.
 * 폭이 좁으면(모바일) 버튼이 본문 아래 줄로 내려간다(flex-wrap + 본문 최소폭).
 */
export function AgentQuestionCard({ work, onReply }: { work: AgentWorkView; onReply: () => void }) {
  return (
    <div className={cn(AI_CONTENT_CONTAINER_CLASS, 'flex flex-wrap items-start gap-3')} data-testid="agent-question-card">
      <div className="min-w-[200px] flex-1 space-y-1">
        <AiLabel>{work.worker.name}의 질문 · 답변 필요</AiLabel>
        {work.note && <p className="break-words text-sm">{work.note}</p>}
      </div>
      <Button size="sm" variant="outline" className="shrink-0" onClick={onReply} data-testid="agent-question-reply">
        <MessageSquare className="h-4 w-4" aria-hidden />
        채팅에서 답하기
      </Button>
    </div>
  );
}
