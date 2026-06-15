// 홈 모듈 콘텐츠 — 고정 대시보드. (AI 캔버스/세션 스위처는 후속 작업에서 정리)
import { PageHeader } from '@/components/layout/PageHeader';

import { Dashboard } from './Dashboard';

/** 홈 셸 — 앱 타이틀 헤더 + 고정 대시보드. */
export function HomeShell() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 홈 헤더 — 사이드바가 없는 홈은 이 상단 헤더가 앱 타이틀을 담당한다.
          공용 PageHeader(h-14·border-b) 로 레일 앱 마크 헤더 및 타 모듈 사이드바 타이틀과 가로 정렬.
          홈은 제품 워드마크 자체가 타이틀이라 아이콘 생략(레일 앱 마크와 중복 회피). */}
      <PageHeader data-testid="canvas-header" title="Smart Workplace" />
      <div className="relative flex-1 overflow-hidden">
        <Dashboard />
      </div>
    </div>
  );
}
