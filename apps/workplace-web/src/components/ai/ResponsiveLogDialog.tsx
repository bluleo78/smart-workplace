// 기록 목록을 여는 반응형 껍데기 — 모바일은 바텀시트(MobileSheetShell), 데스크톱은 대화상자. 개인 정리 기록(WP-385)·공용 기록(WP-386)이 함께 쓴다.
// 본문은 스크롤 영역 안에 놓이고, 그 영역을 인피니트 스크롤 sentinel 의 root 로 children 에 넘긴다(뷰포트 root 는 끝에 닿아야 로드된다).
import { type ReactNode, useState } from 'react';

import { MobileSheetShell } from '@/components/mobile/MobileSheetShell';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useIsMobile } from '@/hooks/useIsMobile';

export function ResponsiveLogDialog({
  open,
  onClose,
  title,
  intro,
  sheetDescription = intro,
  testIdPrefix,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** 본문 위 안내 문구(데스크톱은 대화상자 설명, 모바일은 스크롤 영역 첫 줄). */
  intro: string;
  /** 모바일 시트의 sr-only 설명 — 본문 안내와 겹치면 같은 말을 두 번 읽으니 필요하면 다른 문장으로 준다. */
  sheetDescription?: string;
  /** `-sheet`(모바일)·`-dialog`(데스크톱) 를 붙여 data-testid 로 쓴다. */
  testIdPrefix: string;
  children: (scrollRoot: Element | null) => ReactNode;
}) {
  const mobile = useIsMobile();
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  if (mobile) {
    return (
      <MobileSheetShell open={open} onClose={onClose} title={title} description={sheetDescription} testId={`${testIdPrefix}-sheet`}>
        <div ref={setScrollEl} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
          <p className="break-keep text-sm text-muted-foreground">{intro}</p>
          {children(scrollEl)}
        </div>
      </MobileSheetShell>
    );
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid={`${testIdPrefix}-dialog`} className="flex max-h-[85vh] flex-col gap-4 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="break-keep">{intro}</DialogDescription>
        </DialogHeader>
        <div ref={setScrollEl} className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
          {children(scrollEl)}
        </div>
      </DialogContent>
    </Dialog>
  );
}
