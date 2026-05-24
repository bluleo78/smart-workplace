// SUBTASK 상세 우측 사이드바 — 부모 표시/설정 슬롯 (Phase 4a).
// 부모가 있으면 ParentBadge + 변경 버튼, 없으면 경고 + 부모 설정 버튼.
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
}: {
  projectKey: string;
  issueNumber: number;
  parent: ParentRef | null;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <section
      aria-label="부모"
      data-testid="issue-parent-slot"
      className="space-y-2"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">부모</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditing((v) => !v)}
          data-testid="issue-parent-edit"
        >
          {parent ? '변경' : '부모 설정'}
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
      ) : (
        <p
          className="text-xs text-destructive"
          data-testid="parent-missing-warning"
        >
          부모 없는 SUBTASK — 설정 필요
        </p>
      )}
    </section>
  );
}
