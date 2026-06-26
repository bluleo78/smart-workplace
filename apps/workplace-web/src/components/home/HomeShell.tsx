// 홈 모듈 콘텐츠 — 고정 대시보드. (AI 캔버스/세션 스위처는 후속 작업에서 정리)
import { Dashboard } from './Dashboard';

/**
 * 홈 셸 — 대시보드를 렌더한다.
 * 상단 헤더('아이콘 + 홈' + 편집 토글)는 편집 상태를 소유한 Dashboard 가 직접 그린다(#505).
 */
export function HomeShell() {
  return <Dashboard />;
}
