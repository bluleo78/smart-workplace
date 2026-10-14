// 설정 메모리 카드의 범위 묶음 하나(WP-379, 시안 B) — 소제목 `{범위} · {설명}` + 오른쪽 `n / 50`(45부터 주황, 50이면 "가득 참 · 50 / 50" + 경고 한 줄).
// 유효 행(최신순) 뒤에 만료 행(WP-380). 10개 넘는 묶음은 처음 5개 + "n개 더 보기"로 펼치고 접는다.
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { type AiMemoryScopeKey, COLLAPSE_OVER, collapsedRows, listCountTone, type MemoryGroup, scopeDescription } from '@/lib/aiMemory';
import { cn } from '@/lib/utils';
import { AiMemoryRow } from '@/pages/settings/AiMemoryRow';

interface Props {
  group: MemoryGroup;
  /** 범위마다 상한(서버 limit). */
  limit: number;
  /** 한도에 닿은 범위 — 행 편집의 범위 고르기에 넘긴다. */
  fullScopes: ReadonlySet<AiMemoryScopeKey>;
}

export function AiMemoryScopeGroup({ group, limit, fullScopes }: Props) {
  const [expanded, setExpanded] = useState(false);
  const rows = [...group.active, ...group.expired];
  const visible = collapsedRows(rows, expanded);
  const count = group.active.length;
  const full = count >= limit;
  return (
    <section data-testid="ai-memory-group" data-scope={group.key} className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p data-testid="ai-memory-group-title" className="min-w-0 break-keep text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{group.label}</span> · {scopeDescription(group.key)}
        </p>
        <span data-testid="ai-memory-group-count" className={cn('shrink-0 text-xs tabular-nums', listCountTone(count))}>
          {full ? `가득 참 · ${count} / ${limit}` : `${count} / ${limit}`}
        </span>
      </div>
      {full && (
        <p data-testid="ai-memory-group-full" className="break-keep text-xs text-warning-text">
          {group.label} 메모리가 가득 찼어요. 새로 기억하려면 필요 없는 항목을 지워 주세요. (AI도 새로 저장하지 못해요)
        </p>
      )}
      <ul data-testid="ai-memory-group-list" className="divide-y rounded-md border">
        {visible.map((m) => (
          <AiMemoryRow key={m.id} item={m} fullScopes={fullScopes} />
        ))}
      </ul>
      {rows.length > COLLAPSE_OVER && (
        <Button
          variant="ghost"
          size="sm"
          data-testid="ai-memory-group-more"
          aria-expanded={expanded}
          className="h-7 px-2 text-xs pointer-coarse:min-h-11"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '접기' : `${rows.length - visible.length}개 더 보기`}
        </Button>
      )}
    </section>
  );
}
