// 이슈 상세 헤더 — 제목 대신 브레드크럼(프로젝트 / 부모이슈 / 현재이슈)만 노출 (Jira 스타일).
// 왜: 제목을 헤더(h-14 고정폭)에 두면 가변 길이 제목이 우측 액션·전역 AI 런처와 부딪힌다(#558 회귀).
// 제목은 본문 상단으로 내리고, 헤더는 위치 탐색(경로)에만 집중한다.
// 하위 이슈(SUBTASK)면 부모 크럼이 한 단계 더 끼어든다 — 나중에 에픽 등 상위 레벨이 생기면
// 이 nav 는 그대로 두고 크럼 배열 앞에 한 단계를 추가하면 된다.

import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import type { ParentRef } from '../../../types/issue';
import type { IssueTypeSummary } from '../../../types/issueType';

export function IssueBreadcrumbHeader({
  projectKey,
  projectName,
  parent,
  number,
  type,
  actions,
}: {
  projectKey: string;
  projectName: string;
  parent: ParentRef | null;
  number: number;
  type: IssueTypeSummary | null;
  actions: ReactNode;
}) {
  return (
    <header
      data-testid="page-header"
      className="flex h-14 shrink-0 items-center border-b"
    >
      <div className="container mx-auto flex w-full min-w-0 items-center justify-between gap-2 px-6">
        <nav aria-label="이슈 경로" className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link
            to={`/projects/${projectKey}`}
            className="truncate text-muted-foreground hover:text-foreground"
          >
            {projectName}
          </Link>
          {parent && (
            <>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
              <Link
                to={`/projects/${projectKey}/issues/${parent.number}`}
                className="inline-flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground"
                data-testid={`breadcrumb-parent-${parent.number}`}
              >
                <IssueTypeBadge type={parent.type} size="sm" iconOnly />
                <span className="font-mono">
                  {projectKey}-{parent.number}
                </span>
              </Link>
            </>
          )}
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
          <span
            className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground"
            data-testid="breadcrumb-current"
          >
            {type && <IssueTypeBadge type={type} size="sm" iconOnly />}
            <span className="font-mono">
              {projectKey}-{number}
            </span>
          </span>
        </nav>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
    </header>
  );
}
