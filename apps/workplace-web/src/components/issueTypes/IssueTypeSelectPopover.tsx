// 이슈 유형 단일 선택 픽커 — 항목 클릭 즉시 PATCH 후 close.
// 검색·상세 페이지의 제목 옆 배지로 사용.

import { useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { useIssueTypes } from '../../hooks/queries/useIssueTypes';
import { useUpdateIssueType } from '../../hooks/queries/useUpdateIssueType';
import type { IssueTypeSummary } from '../../types/issueType';
import { IssueTypeBadge } from './IssueTypeBadge';

export function IssueTypeSelectPopover({
  projectKey,
  issueNumber,
  current,
  disabled = false,
}: {
  projectKey: string;
  issueNumber: number;
  current: IssueTypeSummary;
  /** 워크플로 편집 권한 없을 때 트리거 비활성화 — 멤버만 유형 변경 가능. */
  disabled?: boolean;
}) {
  const types = useIssueTypes(projectKey);
  const update = useUpdateIssueType(projectKey, issueNumber);
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="issue-type-trigger"
          aria-label="유형 변경"
          disabled={disabled}
          className="inline-flex min-h-6 disabled:pointer-events-none disabled:opacity-50"
        >
          <IssueTypeBadge type={current} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" data-testid="issue-type-picker">
        <ul className="space-y-0.5" role="radiogroup" aria-label="이슈 유형 선택">
          {(types.data ?? []).map((t) => {
            const checked = t.id === current.id;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-accent ${
                    checked ? 'bg-accent/50' : ''
                  }`}
                  data-testid={`issue-type-option-${t.id}`}
                  onClick={() => {
                    if (!checked) update.mutate(t.id);
                    setOpen(false);
                  }}
                >
                  <IssueTypeBadge
                    type={{
                      id: t.id,
                      name: t.name,
                      colorToken: t.colorToken,
                      icon: t.icon,
                    }}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
