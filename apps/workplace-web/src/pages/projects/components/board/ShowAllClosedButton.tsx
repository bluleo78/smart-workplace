// 「완료 모두 보기」(WP-606) — 종료 이슈를 숨긴 완료·취소 열에서 필터 바 토글과 같은 상태(closed=all)를 켠다.
// 상태 보드 빈 열·모바일 탭 빈 상태·그룹 보드 스윔레인 상태 머리(WP-1021)가 함께 쓴다.
import { CircleCheckBig } from 'lucide-react';

import { Button } from '@/components/ui/button';

// testKey — 열·탭의 statusId(데스크톱·모바일·스윔레인 공통).
export function ShowAllClosedButton({ testKey, onClick, className }: { testKey: number; onClick: () => void; className?: string }) {
  return (
    <Button size="sm" variant="outline" className={className} onClick={onClick} data-testid={`board-col-show-closed-${testKey}`}>
      <CircleCheckBig className="h-4 w-4" />
      완료 모두 보기
    </Button>
  );
}
