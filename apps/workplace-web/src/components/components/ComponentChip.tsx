// 구성요소 칩(WP-933) — 이슈가 속한 영역 이름. 라벨(색 꼬리표)과 구분되게 색 없이 테두리 + 상자 아이콘으로 그린다.
// 보관된 구성요소는 점선 테두리 + 흐린 글자 + 「(보관됨)」 툴팁·스크린리더 문구로 — 이미 붙은 값은 보이되 새로 붙일 수 없다는 것을 알린다.

import { Boxes } from 'lucide-react';

import { splitChips } from '../../lib/issueComponents';
import { cn } from '../../lib/utils';
import type { ComponentSummary } from '../../types/component';

export function ComponentChip({
  component,
  size = 'md',
}: {
  component: Pick<ComponentSummary, 'name' | 'archived'>;
  /** sm = 카드·목록 칸·모바일 행(작게), md = 상세·만들기 창. */
  size?: 'sm' | 'md';
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-sm border border-border text-xs',
        size === 'sm' ? 'px-1 py-0' : 'px-1.5 py-0.5',
        // 보관: 실선 대신 점선 + 이름도 흐리게(활성은 foreground) — 글자색만으로는 구분이 약하다.
        component.archived ? 'border-dashed border-muted-foreground/50 text-muted-foreground' : 'text-foreground',
      )}
      title={component.archived ? `${component.name} (보관됨)` : component.name}
    >
      <Boxes className={cn('shrink-0 text-muted-foreground', size === 'sm' ? 'size-3' : 'size-3.5')} aria-hidden />
      {/* 이름은 8rem 에서 말줄임 — 긴 영역 이름이 카드·칸 폭을 잡아먹지 않게. */}
      <span className="max-w-[8rem] truncate">{component.name}</span>
      {component.archived && <span className="sr-only">(보관됨)</span>}
    </span>
  );
}

/**
 * 구성요소 칩 묶음 — 앞 max 개 + 넘친 수 「+N」(카드·목록 칸·모바일 행은 2개). 없으면 아무것도 그리지 않는다.
 * 다 못 보인 이름은 hover 로 읽게 묶음 title 에 전체 이름을 둔다.
 */
export function ComponentChips({
  components,
  max = 2,
  size = 'sm',
  testId,
  className,
}: {
  components: Pick<ComponentSummary, 'id' | 'name' | 'archived'>[];
  max?: number;
  size?: 'sm' | 'md';
  testId?: string;
  className?: string;
}) {
  if (components.length === 0) return null;
  const { shown, rest } = splitChips(components, max);
  return (
    <span
      className={cn('inline-flex min-w-0 items-center gap-1', className)}
      title={components.map((c) => (c.archived ? `${c.name} (보관됨)` : c.name)).join(', ')}
      data-testid={testId}
    >
      {shown.map((c) => (
        <ComponentChip key={c.id} component={c} size={size} />
      ))}
      {rest > 0 && <span className="shrink-0 text-xs text-muted-foreground">+{rest}</span>}
    </span>
  );
}
