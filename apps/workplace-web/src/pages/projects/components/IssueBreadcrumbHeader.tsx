// 이슈 상세 헤더 — 제목 대신 브레드크럼(프로젝트 / 부모이슈 / 현재이슈)만 노출 (Jira 스타일).
// 왜: 제목을 헤더(h-14 고정폭)에 두면 가변 길이 제목이 우측 액션·전역 AI 런처와 부딪힌다(#558 회귀).
// 제목은 본문 상단으로 내리고, 헤더는 위치 탐색(경로)에만 집중한다.
// 하위 이슈(SUBTASK)면 부모 크럼이 한 단계 더 끼어든다 — 나중에 에픽 등 상위 레벨이 생기면
// 이 nav 는 그대로 두고 크럼 배열 앞에 한 단계를 추가하면 된다.

import { ArrowLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/PageHeader';
import { useIsMobile } from '@/hooks/useIsMobile';

import { ISSUE_TYPE_ICONS } from '../../../lib/issueTypeIcons';
import { getIssueTypeLabel } from '../../../lib/issueTypeLabels';
import type { ParentRef } from '../../../types/issue';
import type { IssueTypeSummary } from '../../../types/issueType';

// 브레드크럼 전용 타입 아이콘 — IssueTypeBadge(전체 배지, data-testid 포함)를 그대로 쓰면
// 본문의 IssueTypeSelectPopover 트리거 배지와 같은 이슈에 같은 testid 가 중복 렌더돼
// getByTestId 가 strict-mode 충돌을 낸다(#558 계열). 아이콘만 필요하므로 배지 없이 그린다.
function BreadcrumbTypeIcon({ type }: { type: IssueTypeSummary }) {
  const Icon = ISSUE_TYPE_ICONS[type.icon] ?? ISSUE_TYPE_ICONS.Circle;
  return <Icon className="h-3.5 w-3.5 shrink-0" aria-label={getIssueTypeLabel(type.name)} />;
}

export function IssueBreadcrumbHeader({
  projectKey,
  projectName,
  parent,
  number,
  type,
  onBack,
  actions,
}: {
  projectKey: string;
  projectName: string;
  parent: ParentRef | null;
  number: number;
  type: IssueTypeSummary | null;
  /** 이전 화면(상세로 들어오기 직전 화면)으로 돌아가기 — 헤더 맨 왼쪽 ← 버튼(#885). */
  onBack: () => void;
  actions: ReactNode;
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    // 모바일: 브레드크럼 대신 병합 상세 헤더(‹ + 이슈 키 + ⋯ + ✦) 한 줄 — 레이아웃 뒤로가기 바와 두 줄로 쌓이지 않는다(U1-1).
    // 채팅·구독·삭제 등 actions 는 모두 ⋯ 메뉴로(파괴적 액션은 인라인에 두지 않음, U1-2). 데스크톱 마크업은 아래 그대로.
    return (
      <PageHeader
        title={
          <span className="inline-flex items-center gap-1" data-testid="breadcrumb-current">
            {type && <BreadcrumbTypeIcon type={type} />}
            <span className="font-mono">
              {projectKey}-{number}
            </span>
          </span>
        }
        actions={actions}
      />
    );
  }
  return (
    <header
      data-testid="page-header"
      className="flex h-14 shrink-0 items-center border-b"
    >
      <div className="container mx-auto flex w-full min-w-0 items-center justify-between gap-2 px-6">
        {/* ← 는 "경로"가 아니라 동작이므로 nav 밖에 둔다. 고정폭(shrink-0)이라 크럼 길이에 흔들리지 않는다. */}
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label="이전 화면으로 돌아가기"
            data-testid="issue-back"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
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
                  <BreadcrumbTypeIcon type={parent.type} />
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
              {type && <BreadcrumbTypeIcon type={type} />}
              <span className="font-mono">
                {projectKey}-{number}
              </span>
            </span>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
    </header>
  );
}
