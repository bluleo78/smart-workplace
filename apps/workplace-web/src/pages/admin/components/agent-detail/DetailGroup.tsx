// 에이전트 상세 섹션 안의 묶음(WP-1281) — 위 구분선 + 제목 + 반영 방식 꼬리표(「바로 반영」「저장해야 반영」).
// 실행 섹션처럼 한 섹션에 저장 방식이 다른 묶음이 섞일 때, 어떤 칸이 바로 바뀌고 어떤 칸이 저장을 기다리는지 제목 옆에서 알게 한다.

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface Props {
  title: ReactNode;
  /** 반영 방식 꼬리표 — 예: 「바로 반영」「저장해야 반영 · 실행 중이면 쉴 때 적용」「Works 가 관리」. */
  how?: ReactNode;
  /** 섹션의 첫 묶음이면 구분선을 빼고 싶을 때. */
  first?: boolean;
  children: ReactNode;
  'data-testid'?: string;
}

export function DetailGroup({ title, how, first = false, children, 'data-testid': testId }: Props) {
  return (
    <div data-testid={testId} className={cn('space-y-3', !first && 'border-t pt-4')}>
      <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        {title}
        {how && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{how}</span>}
      </h3>
      {children}
    </div>
  );
}
