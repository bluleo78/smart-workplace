// 이슈 상세 우측 사이드바 — 부모 표시/설정 슬롯 (Phase 4a, EPIC 계층 확장).
// SUBTASK 는 "부모"(비-EPIC 비-SUBTASK 필수), 일반 이슈는 "상위 에픽"(EPIC, 선택) 문구로 분기.
// 부모가 있으면 ParentBadge + 변경 버튼, 없으면 안내 문구 + 설정 버튼.
// 편집 상태에서는 IssueParentPicker 를 인라인으로 노출.

import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { ParentBadge } from '../../../components/issues/ParentBadge';
import type { ParentRef } from '../../../types/issue';
import { IssueParentPicker } from './IssueParentPicker';

export function IssueParentSlot({
  projectKey,
  issueNumber,
  parent,
  isSubtask,
}: {
  projectKey: string;
  issueNumber: number;
  parent: ParentRef | null;
  isSubtask: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const label = isSubtask ? '부모' : '상위 에픽';

  return (
    <section
      aria-label={label}
      data-testid="issue-parent-slot"
      className="space-y-2"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditing((v) => !v)}
          data-testid="issue-parent-edit"
        >
          {parent ? '변경' : isSubtask ? '부모 설정' : '에픽 연결'}
        </Button>
      </div>
      {editing ? (
        <IssueParentPicker
          projectKey={projectKey}
          issueNumber={issueNumber}
          currentParentNumber={parent?.number ?? null}
          onClose={() => setEditing(false)}
        />
      ) : parent ? (
        <ParentBadge projectKey={projectKey} parent={parent} />
      ) : isSubtask ? (
        <p
          className="text-xs text-destructive"
          data-testid="parent-missing-warning"
        >
          부모 없는 SUBTASK — 설정 필요
        </p>
      ) : (
        <p className="text-xs text-muted-foreground" data-testid="epic-parent-empty">
          연결된 에픽 없음
        </p>
      )}
    </section>
  );
}
