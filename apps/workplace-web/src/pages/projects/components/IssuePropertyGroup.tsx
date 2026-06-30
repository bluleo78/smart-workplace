import { ChevronRight } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

import { usePersistentToggle } from '../../../hooks/usePersistentToggle';

// 속성 레일의 접기 그룹 1개.
// 무엇을: 제목 헤더 클릭으로 펼침/접힘, 접힘 시 count 배지 노출.
// 왜: 사이드바 9개 속성을 사람·일정·분류 3그룹으로 묶어 과밀 해소(#343).
export function IssuePropertyGroup({
  title,
  storageKey,
  defaultOpen,
  count,
  testId,
  children,
}: {
  title: string;
  storageKey: string;
  defaultOpen: boolean;
  count?: number;
  testId: string;
  children: React.ReactNode;
}) {
  const [open, , set] = usePersistentToggle(storageKey, defaultOpen);
  return (
    <Collapsible
      open={open}
      onOpenChange={(o) => set(o)}
      data-testid={testId}
      // 그룹을 라운드 카드로 구분 — 흰 배경 + 보더 + 라운드(그림자 없음).
      className="rounded-xl border bg-card px-4 py-3"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between text-sm font-semibold text-foreground"
        >
          <span>{title}</span>
          <span className="flex items-center gap-1.5">
            {!open && count != null && count > 0 && (
              <Badge variant="secondary" data-testid="property-group-badge">
                {count}
              </Badge>
            )}
            <ChevronRight
              className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
            />
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}
