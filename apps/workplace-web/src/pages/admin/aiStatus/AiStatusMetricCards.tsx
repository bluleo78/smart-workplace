// AI 현황 개요의 지표 자리(WP-1824) — 서버 지표 6장을 제목·값·아랫줄과 함께 한 줄 그리드로 그린다.
// 폭은 모바일 2열 → sm 3열 → xl 6열(설계 §5-3 2)이고, 값·아랫줄은 순수 모델(statCards)이 만든 정의를 그대로 쓴다.
import { StatCard } from "@/components/metrics/StatCard";

import type { StatCardDef } from "./aiStatusModel";

/** 지표 카드 그리드 — 카드 정의(제목·값·아랫줄)를 서버 값 그대로 순서대로 그린다. */
export function AiStatusMetricCards({ cards }: { cards: StatCardDef[] }) {
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
      data-help="ai-status.metrics"
    >
      {cards.map((card) => (
        <StatCard
          key={card.testId}
          testId={card.testId}
          title={card.title}
          value={card.value}
          meta={
            card.note ? (
              <>
                {card.meta}
                <span className="w-full" data-testid={`${card.testId}-limited`}>
                  {card.note}
                </span>
              </>
            ) : (
              card.meta
            )
          }
        />
      ))}
    </div>
  );
}
