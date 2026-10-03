// 모바일 메타 한 줄 — 키 · ◆에픽 · 높음·마감·하위·첫 라벨(+N) … 담당자(최대 2 + N).
// 목록 행(WP-194)과 보드 카드(WP-195)가 같은 정보 순서·말줄임 규칙을 쓰도록 공용화했다.
import { Fragment, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { UserAvatar } from '../../../components/users/UserAvatar';
import { formatDateKorean } from '../../../lib/formatters';
import { isEpicParent } from '../../../lib/issueGrouping';
import { labelFg } from '../../../lib/labelColors';
import type { IssueResponse } from '../../../types/issue';

export function IssueMobileMeta({
  issue: it,
  projectKey,
  testIdPrefix,
  hideEpic = false,
  selected = false,
  className,
}: {
  issue: IssueResponse;
  projectKey: string;
  /** testid 접두 — 행은 `issue-row-N`, 카드는 `issue-card-N`. `-meta`·`-epic` 이 붙는다. */
  testIdPrefix: string;
  /** 특정 에픽 필터·에픽 그룹 안에선 ◆에픽이 중복이라 숨긴다. */
  hideEpic?: boolean;
  /** 선택 행(bg-primary/10)에선 아바타 배경색 ring 을 끈다. */
  selected?: boolean;
  className?: string;
}) {
  // ◆ 에픽 메타 — 부모가 에픽일 때만. 특정 에픽 필터·에픽 그룹 안에선 중복이라 생략.
  const epic = !hideEpic && it.parent && isEpicParent(it) ? it.parent : null;
  // 에픽 색은 ParentChip 과 같은 유형 색 토큰(하드코딩 색 금지). 배경 없는 글자라 칩용 text 가 아닌 fg 톤.
  const epicColor = epic ? labelFg(epic.type.colorToken) : '';
  const firstLabel = it.labels[0];
  // 메타 꼬리 조각(높음·마감·하위·라벨) — 한 span 안에 인라인으로 이어 붙여, 넘치면 끝에서 「…」 로 말줄임된다.
  const tail: ReactNode[] = [];
  if (it.priority === 'HIGH') tail.push(<span key="p" className="text-destructive">높음</span>);
  if (it.dueDate) tail.push(formatDateKorean(it.dueDate));
  if (it.childCount > 0) tail.push(`${it.childDoneCount}/${it.childCount}`);
  if (firstLabel) tail.push(`${firstLabel.name}${it.labels.length > 1 ? ` +${it.labels.length - 1}` : ''}`);
  // 구분점 — 스크린리더가 읽지 않게 aria-hidden.
  const sep = (key: string, cls = 'shrink-0') => (
    <span key={key} aria-hidden="true" className={cls}>
      ·
    </span>
  );
  return (
    <div className={cn('mt-1 flex min-w-0 items-center gap-2', className)}>
      {/* 메타 한 줄 — 키 · ◆에픽 · 꼬리를 flex 로 나열(에픽 뒤 빈 공간 없이 gap 만), 넘치면 꼬리 끝이 말줄임된다. */}
      <p
        className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden whitespace-nowrap text-xs text-muted-foreground"
        data-testid={`${testIdPrefix}-meta`}
      >
        <span className="shrink-0 font-mono">{projectKey}-{it.number}</span>
        {epic && (
          <>
            {sep('se')}
            {/* 에픽은 줄어들지 않고 최대 7.5rem 안에서만 말줄임 — 꼬리가 먼저 잘려 에픽이 「◆ …」 로 사라지지 않게. */}
            <span
              className={`max-w-[7.5rem] shrink-0 truncate ${epicColor}`}
              data-testid={`${testIdPrefix}-epic`}
            >
              ◆ {epic.title}
            </span>
          </>
        )}
        {tail.length > 0 && (
          <>
            {sep('st')}
            <span className="min-w-0 truncate">
              {tail.map((node, i) => (
                <Fragment key={i}>
                  {i > 0 && sep(`s${i}`, 'mx-1')}
                  {node}
                </Fragment>
              ))}
            </span>
          </>
        )}
      </p>
      {it.assignees.length > 0 && (
        <span className="flex shrink-0 items-center -space-x-0.5">
          {/* 선택 행(bg-primary/10)에선 배경색 ring 이 흰 테두리로 떠 보여 끈다(AGENT 보라 ring 은 유지). */}
          {it.assignees.slice(0, 2).map((u) => (
            <UserAvatar key={u.id} user={u} size="xs" ring={!selected} agent={u.kind === 'AGENT'} />
          ))}
          {it.assignees.length > 2 && (
            <span className="ml-1.5 text-xs text-muted-foreground">+{it.assignees.length - 2}</span>
          )}
        </span>
      )}
    </div>
  );
}
