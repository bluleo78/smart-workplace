// 이슈 상세 우측 사이드바 — 부모 표시/설정 슬롯 (Phase 4a, EPIC 계층 확장).
// SUBTASK 는 "부모"(비-EPIC 비-SUBTASK 필수), 일반 이슈는 "상위 에픽"(EPIC, 선택) 문구로 분기.
// 부모가 있으면 ParentBadge + 부모 상태(아이콘·이름, WP-869) + 변경 버튼, 없으면 안내 문구 + 설정 버튼.
// 편집 상태에서는 IssueParentPicker 를 인라인으로 노출.

import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import { ParentBadge } from '../../../components/issues/ParentBadge';
import { statusLabel } from '../../../lib/issueGrouping';
import type { ParentRef } from '../../../types/issue';
import { IssueParentPicker } from './IssueParentPicker';

export function IssueParentSlot({
  projectKey,
  issueNumber,
  parent,
  isSubtask,
  disabled = false,
}: {
  projectKey: string;
  issueNumber: number;
  parent: ParentRef | null;
  isSubtask: boolean;
  /** 워크플로 편집 권한이 없으면 「에픽 연결」·「변경」을 비활성(WP-481 — 저장하면 403 이었다). */
  disabled?: boolean;
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
          disabled={disabled}
          data-testid="issue-parent-edit"
        >
          {parent ? '변경' : isSubtask ? '부모 설정' : '에픽 연결'}
        </Button>
      </div>
      {editing && !disabled ? (
        <IssueParentPicker
          projectKey={projectKey}
          issueNumber={issueNumber}
          currentParent={parent}
          isSubtask={isSubtask}
          onClose={() => setEditing(false)}
        />
      ) : parent ? (
        // 제목이 길면 상태가 다음 줄로 내려간다(flex-wrap) — 좁은 오른쪽 레일에서도 가로로 넘치지 않게.
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* 긴 제목은 레일 폭에서 말줄임(max-w-full) — 가로로 넘치지 않게. */}
          <ParentBadge projectKey={projectKey} parent={parent} className="min-w-0 max-w-full" />
          {/* 부모 상태 — 서버가 범주(status)를 실은 경우만. 이름은 상태 이름, 구 서버 응답이면 범주 라벨. */}
          {parent.status && (
            <span
              className="inline-flex min-w-0 max-w-full items-center gap-1 text-xs text-muted-foreground"
              data-testid="issue-parent-status"
            >
              <IssueStatusIcon status={parent.status} color={parent.statusColor} decorative className="size-3.5" />
              <span className="truncate">{statusLabel(parent.status, parent.statusName)}</span>
            </span>
          )}
        </div>
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
