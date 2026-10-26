// 이슈 「관계」 묶음의 한 줄 — 차단(의존성)과 이슈 사이 관계(WP-887)가 같이 쓴다.
// 구성(한 줄, WP-991): 상태 아이콘(상태 색) + 유형 아이콘 + 표시 키(같은 프로젝트 #12 · 다른 프로젝트 WPV-28)
//   + 제목(그 프로젝트 이슈 화면 링크, 남는 폭에서 말줄임) + 제거 버튼.
//   예전엔 상태 이름을 둘째 줄에 글자로 내렸는데(WP-809) 관계 하나가 두 줄을 차지해 어색했다 — 상태 이름은
//   아이콘의 툴팁·aria-label 로 옮겨 제목이 한 줄 폭을 다 쓰게 한다. 범주 색 배지는 여전히 쓰지 않는다(같은 상태가 두 색으로 보였다).
// 제거는 confirm 없이 즉시 호출 — 소규모 작업이므로 토스트 + invalidate 만으로 충분.
// WP-237: 터치 기기(pointer: coarse)는 hover 가 없어 X 에 닿을 수 없으므로 행 끝 ⋯(44px) 하나로 모은다.
//   폭 <1024 → 액션 시트, ≥1024(태블릿의 좁은 오른쪽 레일) → DropdownMenu. 마우스 데스크톱은 기존 hover X 그대로.
//   X 를 그냥 상시 노출하지 않는 이유: 제거는 확인창 없이 즉시 실행되므로 ⋯ 한 단계가 오조작 가드다
//   (확인창이 있는 드라이브 링크 X 는 상시 노출 — IssueDriveLinkItem 과의 의도적 차이).

import { Unlink, X } from 'lucide-react';
import { Link } from 'react-router-dom';

import { TouchRowActionsMenu } from '@/components/mobile/TouchRowActionsMenu';
import { Button } from '@/components/ui/button';
import { IconHint } from '@/components/ui/icon-hint';
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer';
import { statusLabel } from '@/lib/issueGrouping';
import { relatedIssueKey } from '@/lib/issueRelations';

import type { IssueStatus } from '../../types/issue';
import type { IssueTypeSummary } from '../../types/issueType';
import { IssueTypeBadge } from '../issueTypes/IssueTypeBadge';
import { IssueStatusIcon } from './IssueStatusIcon';

/** 줄에 그릴 상대 이슈 — 의존성 요약(IssueLinkSummary)과 관계 상대(RelatedIssueSummary)가 모두 맞는 모양. */
interface LinkRowIssue {
  number: number;
  title: string;
  status: string;
  /** 프로젝트 상태 이름·색(WP-869) — 의존성 요약에만 있고, 없으면 범주 라벨·범주 색으로 그린다. */
  statusName?: string;
  statusColor?: string | null;
  type: IssueTypeSummary | null;
}

export function IssueLinkRow({
  projectKey,
  currentProjectKey = projectKey,
  link,
  onRemove,
  removeLabel = '차단 제거',
  testIdPrefix = 'issue-link',
  testIdKey = link.number,
}: {
  /** 이 줄 이슈의 프로젝트 키 — 링크 주소와 다른 프로젝트 키 표시에 쓴다. */
  projectKey: string;
  /** 지금 보고 있는 이슈의 프로젝트 키 — 같으면 키를 `#12` 로 줄인다. 생략하면 같은 프로젝트. */
  currentProjectKey?: string;
  link: LinkRowIssue;
  /** 없으면 제거 조작을 그리지 않는다 — 워크플로 편집 권한이 없는 OPEN 비멤버(WP-503, 서버는 멤버만 허용). */
  onRemove?: () => void;
  /** 제거 버튼·메뉴 이름 — 차단은 「차단 제거」, 관계는 「관계 제거」. */
  removeLabel?: string;
  /** testid 접두사 — 차단 줄은 기존 `issue-link-*`(E2E 계약), 관계 줄은 `issue-relation-*`. */
  testIdPrefix?: string;
  /** testid 끝 — 차단 줄은 이슈 번호, 관계 줄은 관계 id(다른 프로젝트와 번호가 겹칠 수 있어서). */
  testIdKey?: number | string;
}) {
  const isCoarse = useIsCoarsePointer();
  const displayKey = relatedIssueKey(projectKey, currentProjectKey, link.number);

  const statusText = statusLabel(link.status, link.statusName);

  return (
    // group: hover-reveal 패턴 — hover 시 배경 + 삭제 버튼 표시 (IssueAttachmentItem 동일 패턴)
    <li
      className="group flex min-w-0 items-center gap-2 rounded px-1 -mx-1 text-sm py-1 hover:bg-accent/50"
      data-testid={`${testIdPrefix}-row-${testIdKey}`}
    >
      {/* 상태 — 아이콘(상태 색)만 두고 이름은 툴팁(마우스)·팝오버(터치)로(구 서버 응답·관계 상대면 범주 라벨). 아이콘이 이름을 aria-label 로 알린다. */}
      <IconHint label={statusText} data-testid={`${testIdPrefix}-status-${testIdKey}`}>
        <IssueStatusIcon
          status={link.status as IssueStatus}
          name={link.statusName}
          color={link.statusColor}
          className="size-3.5"
        />
      </IconHint>
      {link.type && <IssueTypeBadge type={link.type} size="sm" iconOnly />}
      <span className="shrink-0 font-mono text-xs text-muted-foreground">{displayKey}</span>
      <Link
        to={`/projects/${projectKey}/issues/${link.number}`}
        className="min-w-0 flex-1 truncate hover:underline"
        // 레일이 좁아 제목이 자주 잘린다 — 마우스를 올리면 전체 제목.
        title={link.title}
      >
        {link.title}
      </Link>
      {onRemove && (isCoarse ? (
        // WP-237: 터치용 ⋯ — 44px 터치 영역이 행 높이를 키우지 않도록 음수 세로 마진으로 시각 크기만 유지.
        <TouchRowActionsMenu
          title={`${displayKey} ${link.title}`}
          ariaLabel={`${displayKey} 더보기`}
          testId={`${testIdPrefix}-more-${testIdKey}`}
          sheetTestId={`${testIdPrefix}-sheet`}
          itemTestId={(key) => `${testIdPrefix}-menu-${key}-${testIdKey}`}
          triggerClassName="-my-2.5"
          actions={[{ key: 'remove', label: removeLabel, icon: <Unlink />, destructive: true, onSelect: onRemove }]}
        />
      ) : (
        // 마우스 데스크톱: hover·키보드 포커스 때만 보인다 — 파괴적 작업 보호. 숨김은 투명도로만 해서(display:none 이 아님)
        // Tab 순서에 남고, 포커스를 받으면 보인다(WP-468 — hidden 이면 키보드로 닿을 수 없었다). 노트 트리 행과 같은 패턴.
        // 늘 자리를 차지하므로 행 높이를 키우지 않게 24px(size-6)로 둔다.
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label={removeLabel}
          className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          data-testid={`${testIdPrefix}-remove-${testIdKey}`}
        >
          <X className="h-4 w-4" />
        </Button>
      ))}
    </li>
  );
}
