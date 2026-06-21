import type { ReactNode } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** 모든 홈 위젯 공통 프레임 — 제목 + ai-accent 좌측 보더 + 본문. */
export function WidgetFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="border-l-2 border-l-ai-accent" data-testid="home-widget">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
