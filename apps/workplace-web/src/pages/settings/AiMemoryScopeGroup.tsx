// 설정 메모리 카드의 범위 묶음 하나(WP-379, 시안 B) — 소제목 `{범위} · {설명}` + 오른쪽 `n / 300`(270부터 주황, 300이면 "가득 참 · 300 / 300" + 경고 한 줄).
// 유효 행(고정 먼저, 최신순) 뒤에 만료 행(WP-380). WP-383: 행은 카드가 인피니트 스크롤로 잘라 넘긴다(rows) — 묶음 자체는 접지 않는다.
// 카운트·가득 참은 거르기 전 묶음 그대로(검색 중엔 앞에 "N개 일치 · "), 범위 고정이 가득이면 행 핀을 막는다.
import { useId } from 'react';

import { type AiMemoryScopeKey, listCountTone, type MemoryGroup, pinFullHint, pinnedCount, scopeDescription } from '@/lib/aiMemory';
import { cn } from '@/lib/utils';
import { AiMemoryRow } from '@/pages/settings/AiMemoryRow';
import type { AiMemoryItem } from '@/types/aiMemory';

interface Props {
  /** 거르기 전 묶음 — 카운트·가득 참·고정 수 기준. */
  group: MemoryGroup;
  /** 이번에 그릴 행(검색·인피니트 스크롤로 자른 것). */
  rows: AiMemoryItem[];
  /** 검색 중 이 묶음에서 맞는 행 수(자르기 전) — 검색하지 않으면 null. */
  matched: number | null;
  /** 범위마다 고정 상한(서버 pinLimit). */
  pinLimit: number;
  /** 범위마다 상한(서버 limit). */
  limit: number;
  /** 한도에 닿은 범위 — 행 편집의 범위 고르기에 넘긴다. */
  fullScopes: ReadonlySet<AiMemoryScopeKey>;
}

export function AiMemoryScopeGroup({ group, rows, matched, limit, pinLimit, fullScopes }: Props) {
  const titleId = useId();
  const count = group.active.length;
  const full = count >= limit;
  const hint = pinnedCount(group) >= pinLimit ? pinFullHint(pinLimit) : null;
  return (
    <section data-testid="ai-memory-group" data-scope={group.key} aria-labelledby={titleId} className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        {/* 제목은 실제 heading(h3) — 시각 모양은 기존 작은 muted 문구 그대로. */}
        <h3 id={titleId} data-testid="ai-memory-group-title" className="min-w-0 break-keep text-xs font-normal text-muted-foreground">
          <span className="font-medium text-foreground">{group.label}</span> · {scopeDescription(group.key)}
        </h3>
        <span data-testid="ai-memory-group-count" className={cn('shrink-0 text-xs tabular-nums', listCountTone(count))}>
          {matched != null && `${matched}개 일치 · `}
          {full ? `가득 참 · ${count} / ${limit}` : `${count} / ${limit}`}
        </span>
      </div>
      {full && (
        <p data-testid="ai-memory-group-full" className="break-keep text-xs text-warning-text">
          {group.label} 메모리가 가득 찼어요. 새로 기억하려면 필요 없는 항목을 지워 주세요. (AI도 새로 저장하지 못해요)
        </p>
      )}
      <ul data-testid="ai-memory-group-list" className="divide-y rounded-md border">
        {rows.map((m) => (
          <AiMemoryRow key={m.id} item={m} fullScopes={fullScopes} pinFullHint={hint} />
        ))}
      </ul>
    </section>
  );
}
