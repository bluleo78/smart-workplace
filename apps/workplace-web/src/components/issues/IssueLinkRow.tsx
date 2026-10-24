// 의존성/관련 이슈 한 행 (Phase 4b).
// 구성(2줄, 부모 슬롯 IssueParentSlot 과 같은 모양): 1줄 = 유형 아이콘 + KEY-N + 제목 + 제거 버튼,
//   2줄 = 상태 아이콘(상태 색) + 상태 이름(보조 글자). 좁은 오른쪽 레일에서도 제목이 상태에 밀려 굶지 않게 상태를 아래 줄로 내렸고,
//   범주 색 배지는 쓰지 않는다 — 상태 색 아이콘 옆에 범주 색 배지가 붙으면 같은 상태가 두 색으로 보였다(WP-809 디자이너 리뷰).
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
import { statusLabel } from '@/lib/issueGrouping';

import type { IssueLinkSummary, IssueStatus } from '../../types/issue';
import { IssueTypeBadge } from '../issueTypes/IssueTypeBadge';
import { IssueStatusIcon } from './IssueStatusIcon';

export function IssueLinkRow({
  projectKey,
  link,
  onRemove,
}: {
  projectKey: string;
  link: IssueLinkSummary;
  /** 없으면 제거 조작을 그리지 않는다 — 워크플로 편집 권한이 없는 OPEN 비멤버(WP-503, 서버는 멤버만 허용). */
  onRemove?: () => void;
}) {
  const isCoarse = useIsCoarsePointer();

  return (
    // group: hover-reveal 패턴 — hover 시 배경 + 삭제 버튼 표시 (IssueAttachmentItem 동일 패턴)
    <li
      className="group flex items-start gap-2 rounded px-1 -mx-1 text-sm py-1 hover:bg-accent/50"
      data-testid={`issue-link-row-${link.number}`}
    >
      {/* 유형 아이콘은 첫 줄(제목 줄, 20px) 가운데에 맞춘다. */}
      <span className="flex h-5 shrink-0 items-center">
        <IssueTypeBadge type={link.type} size="sm" iconOnly />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {projectKey}-{link.number}
          </span>
          <Link
            to={`/projects/${projectKey}/issues/${link.number}`}
            className="min-w-0 flex-1 truncate hover:underline"
            title={link.title}
          >
            {link.title}
          </Link>
        </div>
        {/* 상태 — 아이콘은 상태 색, 이름은 상태 이름(구 서버 응답이면 범주 라벨). 이름이 읽히므로 아이콘은 장식.
            KEY 시작선에 맞춰 들여쓰고, 30자 이름은 말줄임(title 로 전체). */}
        <div
          className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
          data-testid={`issue-link-status-${link.number}`}
        >
          <IssueStatusIcon status={link.status as IssueStatus} color={link.statusColor} decorative className="size-3.5" />
          <span className="truncate" title={statusLabel(link.status, link.statusName)}>
            {statusLabel(link.status, link.statusName)}
          </span>
        </div>
      </div>
      {onRemove && (isCoarse ? (
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
        // 마우스 데스크톱: hover·키보드 포커스 때만 보인다 — 파괴적 작업 보호. 숨김은 투명도로만 해서(display:none 이 아님)
        // Tab 순서에 남고, 포커스를 받으면 보인다(WP-468 — hidden 이면 키보드로 닿을 수 없었다). 노트 트리 행과 같은 패턴.
        // 늘 자리를 차지하므로 행 높이를 키우지 않게 24px(size-6)로 둔다.
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label="의존성 제거"
          className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          data-testid={`issue-link-remove-${link.number}`}
        >
          <X className="h-4 w-4" />
        </Button>
      ))}
    </li>
  );
}
