import { Suspense } from 'react';
import type { CanvasPage } from '@/hooks/useCanvasState';
import { getWidget } from './widgets/registry';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface Props {
  pages: CanvasPage[];
  activeIndex: number;
  onSelectPage: (index: number) => void;
}

/** 캔버스 레이어 — 활성 페이지의 위젯 그리드 + 하단 PageIndicator(멀티페이지). */
export function HomeCanvas({ pages, activeIndex, onSelectPage }: Props) {
  const active = pages[activeIndex];
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto p-6" data-testid="home-canvas">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {active?.widgets.map((w) => {
            const Widget = getWidget(w.spec.type);
            if (!Widget) return null;
            return (
              <Suspense key={w.id} fallback={<Skeleton className="h-32 w-full" />}>
                <Widget params={w.spec.params} />
              </Suspense>
            );
          })}
        </div>
      </div>
      {pages.length > 1 && (
        <div className="flex justify-center gap-2 py-2" data-testid="page-indicator">
          {pages.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelectPage(i)}
              aria-label={p.label}
              aria-current={i === activeIndex}
              className={cn(
                'h-2 w-2 rounded-full transition-colors',
                i === activeIndex ? 'bg-ai-accent' : 'bg-muted-foreground/30',
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
