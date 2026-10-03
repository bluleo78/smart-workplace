// 모바일 이슈 행 셀 — 표 칸 대신 한 칸(colSpan) 안에 2줄 블록을 그린다(WP-194).
// 1줄: 상태 아이콘 + 제목(최대 2줄). 2줄: 키 · ◆에픽 · 높음 · 마감 · 하위 n/m · 첫 라벨(+N) … 담당자.
// 표 구조(<tr>)를 유지해야 평면/그룹/사이클 구간 목록이 같은 행 컴포넌트를 계속 공유할 수 있다.
import { CheckCircle2 } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import { UserAvatar } from '../../../components/users/UserAvatar';
import { formatDateKorean } from '../../../lib/formatters';
import { isEpicParent } from '../../../lib/issueGrouping';
import { LABEL_COLORS } from '../../../lib/labelColors';
import type { IssueResponse } from '../../../types/issue';
import type { ColorToken } from '../../../types/label';

export function IssueRowMobileCell({
  issue: it,
  projectKey,
  to,
  selected,
  hideEpic,
  colSpan,
}: {
  issue: IssueResponse;
  projectKey: string;
  to: string;
  selected: boolean;
  hideEpic: boolean;
  /** 표 컬럼 수 — IssueListRow 가 넘긴다(상수를 여기서 import 하면 순환 참조). */
  colSpan: number;
}) {
  // ◆ 에픽 메타 — 부모가 에픽일 때만. 특정 에픽 필터·에픽 그룹 안에선 중복이라 생략.
  const epic = !hideEpic && it.parent && isEpicParent(it) ? it.parent : null;
  // 에픽 색은 ParentChip 과 같은 유형 색 토큰(하드코딩 색 금지). 배경 없는 글자라 칩용 text 가 아닌 fg 톤.
  const epicColor = epic ? (LABEL_COLORS[epic.type.colorToken as ColorToken] ?? LABEL_COLORS.GRAY).fg : '';
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
    <td colSpan={colSpan} className="px-1 py-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 shrink-0">
          {/* 선택 표시는 상태 아이콘과 같은 18px — 바뀌어도 제목이 밀리지 않게. */}
          {selected ? (
            <CheckCircle2 className="h-[18px] w-[18px] text-primary" aria-label="선택됨" />
          ) : (
            <IssueStatusIcon status={it.status} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          {/* 제목 = 실제 링크(접근점). 행 onClick 과 history 이중 push 를 막으려 stopPropagation. */}
          <Link
            to={to}
            onClick={(e) => e.stopPropagation()}
            data-testid={`issue-row-${it.number}-title`}
            className="line-clamp-2 break-words text-sm font-medium leading-snug [-webkit-touch-callout:none]"
          >
            {it.title}
          </Link>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            {/* 메타 한 줄 — 키 · ◆에픽 · 꼬리를 flex 로 나열(에픽 뒤 빈 공간 없이 gap 만), 넘치면 꼬리 끝이 말줄임된다. */}
            <p
              className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden whitespace-nowrap text-xs text-muted-foreground"
              data-testid={`issue-row-${it.number}-meta`}
            >
              <span className="shrink-0 font-mono">{projectKey}-{it.number}</span>
              {epic && (
                <>
                  {sep('se')}
                  {/* 에픽은 줄어들지 않고 최대 7.5rem 안에서만 말줄임 — 꼬리가 먼저 잘려 에픽이 「◆ …」 로 사라지지 않게. */}
                  <span
                    className={`max-w-[7.5rem] shrink-0 truncate ${epicColor}`}
                    data-testid={`issue-row-${it.number}-epic`}
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
        </div>
      </div>
    </td>
  );
}
