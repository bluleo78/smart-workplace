// 일정 미정 이슈 섹션 — 간트에 막대로 그릴 수 없는(startDate/dueDate 모두 없는) 이슈를
// 접이식 목록으로 노출한다. 멤버는 [타임라인에 배치] 로 기본 기간(오늘~+7일)을 부여해 막대로 승격시킬 수 있다.
import { ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { IssueResponse } from '@/types/issue';

import { IssueStatusBadge } from '../components/IssueStatusBadge';

export interface UnscheduledSectionProps {
  issues: IssueResponse[];
  readOnly: boolean;
  onSchedule: (issueNumber: number) => void;
}

export function UnscheduledSection({ issues, readOnly, onSchedule }: UnscheduledSectionProps) {
  if (issues.length === 0) return null;

  return (
    // group 으로 details[open] 상태를 chevron 회전에 전달 (AiContent 접이식 관례 미러).
    <details className="group border-t px-6 py-2" data-testid="unscheduled-section">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium">
        <ChevronRight
          className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        일정 미정 ({issues.length})
      </summary>
      <ul className="mt-2 space-y-1">
        {issues.map((issue) => (
          <li
            key={issue.id}
            className="flex items-center gap-2 rounded px-1 py-1 text-sm"
            data-testid={`unscheduled-row-${issue.number}`}
          >
            <span className="text-muted-foreground">
              {issue.projectKey}-{issue.number}
            </span>
            <span className="flex-1 truncate">{issue.title}</span>
            {/* 소속 에픽 배지 (#649) — 미정 이슈가 어느 에픽 계획에 속하는지 표시. */}
            {issue.parent?.type.name === 'EPIC' && (
              <span className="max-w-32 truncate rounded-sm bg-epic-subtle px-1.5 text-xs text-epic">
                {issue.parent.title}
              </span>
            )}
            <IssueStatusBadge status={issue.status} />
            {!readOnly && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSchedule(issue.number)}
                data-testid={`unscheduled-schedule-${issue.number}`}
              >
                타임라인에 배치
              </Button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
