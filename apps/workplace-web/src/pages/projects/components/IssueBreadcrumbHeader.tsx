// 이슈 상세 헤더 — 제목 대신 브레드크럼(프로젝트 / 부모이슈 / 현재이슈)만 노출 (Jira 스타일).
// 왜: 제목을 헤더(h-14 고정폭)에 두면 가변 길이 제목이 우측 액션·전역 AI 런처와 부딪힌다(#558 회귀).
// 제목은 본문 상단으로 내리고, 헤더는 위치 탐색(경로)에만 집중한다.
// 하위 이슈(SUBTASK)면 부모 크럼이 한 단계 더 끼어든다 — 나중에 에픽 등 상위 레벨이 생기면
// 이 nav 는 그대로 두고 크럼 배열 앞에 한 단계를 추가하면 된다.

import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

import { Breadcrumb, type BreadcrumbItem } from '@/components/layout/Breadcrumb';
import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
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

/** 경로의 이슈 단계 이름 — 타입 아이콘 + 키(WP-8). 링크 글자와 같은 줄에서 아이콘이 가운데 맞게 inline-flex. */
function IssueCrumbLabel({ type, projectKey, number }: { type: IssueTypeSummary | null; projectKey: string; number: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      {type && <BreadcrumbTypeIcon type={type} />}
      <span className="font-mono">
        {projectKey}-{number}
      </span>
    </span>
  );
}

export function IssueBreadcrumbHeader({
  projectKey,
  projectName,
  parent,
  number,
  type,
  onBack,
  actions,
  mobilePrimaryAction,
  mobileActions,
}: {
  projectKey: string;
  projectName: string;
  parent: ParentRef | null;
  number: number;
  type: IssueTypeSummary | null;
  /** 이전 화면(상세로 들어오기 직전 화면)으로 돌아가기 — 헤더 맨 왼쪽 ← 버튼(#885). */
  onBack: () => void;
  actions: ReactNode;
  /** 모바일 전용: ⋯ 밖 인라인 주 액션(채팅 아이콘, M5). */
  mobilePrimaryAction?: ReactNode;
  /** 모바일 전용: ⋯ 메뉴 내용. 생략하면 actions 전체 — 주 액션과 같은 버튼이 두 번 렌더되지 않게 나눠 넘긴다. */
  mobileActions?: ReactNode;
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    // 모바일: 브레드크럼 대신 병합 상세 헤더(‹ + 이슈 키 + ⋯ + ✦) 한 줄 — 레이아웃 뒤로가기 바와 두 줄로 쌓이지 않는다(U1-1).
    // 채팅은 자주 쓰고 미읽음 신호가 있어 ⋯ 밖 아이콘으로(M5), 구독·삭제는 ⋯ 메뉴로(파괴적 액션은 인라인에 두지 않음, U1-2).
    // 데스크톱은 아래에서 Page.Header 의 leading 슬롯에 ← + 브레드크럼을 둔다.
    return (
      <Page.Header
        title={
          <span className="inline-flex items-center gap-1" data-testid="breadcrumb-current">
            {type && <BreadcrumbTypeIcon type={type} />}
            <span className="font-mono">
              {projectKey}-{number}
            </span>
          </span>
        }
        actions={actions}
        mobilePrimaryAction={mobilePrimaryAction}
        mobileActions={mobileActions}
        // ‹ 도 데스크톱 ← 와 같은 규칙 — 상세로 들어오기 직전 화면으로(없으면 프로젝트 화면, #885).
        mobileOnBack={onBack}
      />
    );
  }
  // 경로 단계: 프로젝트 › (부모 이슈) › 현재 이슈. 이슈 단계는 타입 아이콘 + 키로 보인다.
  const items: BreadcrumbItem[] = [
    { key: 'project', label: projectName, title: projectName, to: `/projects/${projectKey}` },
    ...(parent
      ? [{
          key: `parent-${parent.number}`,
          label: <IssueCrumbLabel type={parent.type} projectKey={projectKey} number={parent.number} />,
          to: `/projects/${projectKey}/issues/${parent.number}`,
          testId: `breadcrumb-parent-${parent.number}`,
        }]
      : []),
    {
      key: 'current',
      label: <IssueCrumbLabel type={type} projectKey={projectKey} number={number} />,
      testId: 'breadcrumb-current',
    },
  ];
  // 데스크톱: 공용 Page.Header 의 leading 슬롯에 ← + 브레드크럼을 둔다 — 자체 header/container 를 두면
  // 넓은 화면에서 헤더만 가운데로 몰려 본문 제목과 372px 어긋났다. 여백·AI 칩 클램프는 Page.Header 가 소유.
  return (
    <Page.Header
      leadingGrow
      leading={
        <>
          {/* ← 는 "경로"가 아니라 동작이므로 nav 밖에 둔다. 고정폭(shrink-0)이라 크럼 길이에 흔들리지 않는다. */}
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
          {/* 경로는 공용 Breadcrumb(§B-1) — 구분자·무게·접기를 다른 앱과 같게 한다(WP-979). 프로젝트가 시작점이다. */}
          <Breadcrumb items={items} aria-label="이슈 경로" data-testid="issue-breadcrumb" />
        </>
      }
      actions={actions}
    />
  );
}
