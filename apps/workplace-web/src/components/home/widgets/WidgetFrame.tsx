import { createContext, type ReactNode, useContext } from 'react';

import { Card, CardContent, CardHeader } from '@/components/ui/card';

/** 위젯 제목 헤딩 레벨 — 2·3 만 쓴다(AI 챗은 h2, 대시보드 카드·미리보기 안은 h3). */
export type WidgetHeadingLevel = 2 | 3;

/**
 * 위젯이 놓인 곳의 헤딩 레벨 문맥. 기본 2 — AI 챗(패널·전체화면·모바일 시트)은 자체 헤딩이 없어
 * 위젯 제목이 페이지 H1 바로 아래 단계가 된다(옆 패널이면 그 페이지의 h2 구역들과 같은 단계).
 * 대시보드 카드(h2)·위젯 추가 대화상자(h2) 안에서는 제공자가 3 을 내려 위계가 건너뛰지 않게 한다.
 */
const WidgetHeadingLevelContext = createContext<WidgetHeadingLevel>(2);

/** 아래 위젯들의 제목 헤딩 레벨을 정한다. */
export function WidgetHeadingLevelProvider({ level, children }: { level: WidgetHeadingLevel; children: ReactNode }) {
  return <WidgetHeadingLevelContext.Provider value={level}>{children}</WidgetHeadingLevelContext.Provider>;
}

/**
 * 모든 홈 위젯 공통 프레임 — 제목 + ai-accent 좌측 보더 + 본문.
 * 제목은 스크린리더 헤딩 탐색에 잡히도록 문맥 레벨의 h2/h3 로 그린다(WP-1888).
 * 겉모습은 CardTitle 과 같게 그 클래스·data-slot 을 그대로 둔다(ui/card.tsx 는 손대지 않는다).
 */
export function WidgetFrame({ title, children }: { title: string; children: ReactNode }) {
  const level = useContext(WidgetHeadingLevelContext);
  const Heading = level === 3 ? 'h3' : 'h2';
  return (
    <Card className="border-l-2 border-l-ai-accent" data-testid="home-widget">
      <CardHeader className="pb-2">
        {/* CardTitle 의 기본(leading-none font-semibold)에 font-medium 을 덮어쓴 결과를 고정 문자열로 둔다 */}
        <Heading data-slot="card-title" className="leading-none text-sm font-medium text-muted-foreground">
          {title}
        </Heading>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
