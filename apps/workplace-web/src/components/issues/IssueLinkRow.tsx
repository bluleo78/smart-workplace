// 의존성/관련 이슈 한 행 (Phase 4b).
// 구성: 유형 아이콘 + KEY-N + 제목 + 상태 + 제거 버튼.
// 제거는 confirm 없이 즉시 호출 — 소규모 작업이므로 토스트 + invalidate 만으로 충분.
// WP-237: 터치 기기(pointer: coarse)는 hover 가 없어 X 에 닿을 수 없으므로 행 끝 ⋯(44px) 하나로 모은다.
//   폭 <1024 → 액션 시트, ≥1024(태블릿의 좁은 오른쪽 레일) → DropdownMenu. 마우스 데스크톱은 기존 hover X 그대로.
//   X 를 그냥 상시 노출하지 않는 이유: 의존성 제거는 확인창 없이 즉시 실행되므로 ⋯ 한 단계가 오조작 가드다
//   (확인창이 있는 드라이브 링크 X 는 상시 노출 — IssueDriveLinkItem 과의 의도적 차이).

import { Unlink, X } from 'lucide-react';
import { Link } from 'react-router-dom';

import { TouchRowActionsMenu } from '@/components/mobile/TouchRowActionsMenu';
import { Button } from '@/components/ui/button';
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer';

import { IssueStatusBadge } from '../../pages/projects/components/IssueStatusBadge';
import type { IssueLinkSummary, IssueStatus } from '../../types/issue';
import { IssueTypeBadge } from '../issueTypes/IssueTypeBadge';

export function IssueLinkRow({
  projectKey,
  link,
  onRemove,
}: {
  projectKey: string;
  link: IssueLinkSummary;
  onRemove: () => void;
}) {
  const isCoarse = useIsCoarsePointer();

  return (
    // group: hover-reveal 패턴 — hover 시 배경 + 삭제 버튼 표시 (IssueAttachmentItem 동일 패턴)
    <li
      className="group flex items-center gap-2 rounded px-1 -mx-1 text-sm py-1 hover:bg-accent/50"
      data-testid={`issue-link-row-${link.number}`}
    >
      <IssueTypeBadge type={link.type} size="sm" iconOnly />
      <span className="font-mono text-xs text-muted-foreground">
        {projectKey}-{link.number}
      </span>
      <Link
        to={`/projects/${projectKey}/issues/${link.number}`}
        className="flex-1 truncate hover:underline"
      >
        {link.title}
      </Link>
      <IssueStatusBadge status={link.status as IssueStatus} />
      {isCoarse ? (
        // WP-237: 터치용 ⋯ — 44px 터치 영역이 행 높이를 키우지 않도록 음수 세로 마진으로 시각 크기만 유지.
        <TouchRowActionsMenu
          title={`${projectKey}-${link.number} ${link.title}`}
          ariaLabel="의존성 더보기"
          testId={`issue-link-more-${link.number}`}
          sheetTestId="issue-link-sheet"
          itemTestId={(key) => `issue-link-menu-${key}-${link.number}`}
          triggerClassName="-my-2.5"
          actions={[{ key: 'remove', label: '의존성 제거', icon: <Unlink />, destructive: true, onSelect: onRemove }]}
        />
      ) : (
        // 마우스 데스크톱: hover 시에만 노출 — 파괴적 작업 보호
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label="의존성 제거"
          className="hidden group-hover:inline-flex"
          data-testid={`issue-link-remove-${link.number}`}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </li>
  );
}
