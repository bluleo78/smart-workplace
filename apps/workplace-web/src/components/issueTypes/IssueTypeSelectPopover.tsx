// 이슈 유형 단일 선택 픽커 — 항목 클릭 즉시 PATCH 후 close.
// 검색·상세 페이지의 제목 옆 배지로 사용.
// SUBTASK 는 부모가 필수라(WP-745) 고르면 바로 저장하지 않고 부모 번호를 받는 단계로 넘어가, 유형·부모를 한 요청으로 보낸다.

import { useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SELECTED_ROW_CLASS } from '@/lib/selectionStyles';
import { cn } from '@/lib/utils';

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
  // SUBTASK 를 골랐을 때 부모 번호를 받는 단계 — 고른 SUBTASK 유형 id. null 이면 유형 목록.
  const [subtaskTypeId, setSubtaskTypeId] = useState<number | null>(null);
  const [parentValue, setParentValue] = useState('');

  // 팝오버를 닫으면 부모 입력 단계를 버린다 — 다시 열면 유형 목록부터.
  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setSubtaskTypeId(null);
      setParentValue('');
    }
  }

  // 부모 번호는 양의 정수만 — 그 밖은 저장 버튼을 막는다(서버도 같은 프로젝트·SUBTASK 가 아닌 부모인지 다시 본다).
  const parentNumber = Number(parentValue.trim());
  const parentValid = parentValue.trim() !== '' && Number.isInteger(parentNumber) && parentNumber > 0;

  async function onSaveSubtask() {
    if (subtaskTypeId == null || !parentValid) return;
    try {
      await update.mutateAsync({ typeId: subtaskTypeId, parentNumber });
      onOpenChange(false);
    } catch {
      // 에러 토스트는 훅이 띄운다 — 입력을 고쳐 다시 저장할 수 있게 열어 둔다.
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
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
        {subtaskTypeId != null ? (
          <form
            className="space-y-2 p-2"
            data-testid="issue-type-subtask-parent"
            onSubmit={(e) => {
              e.preventDefault();
              void onSaveSubtask();
            }}
          >
            <label className="text-sm font-medium" htmlFor="issue-type-parent-input">
              부모 이슈 번호
            </label>
            <p className="text-xs text-muted-foreground">하위 태스크는 부모 이슈가 있어야 합니다.</p>
            <Input
              id="issue-type-parent-input"
              value={parentValue}
              onChange={(e) => setParentValue(e.target.value)}
              placeholder="예: 12"
              type="number"
              min={1}
              autoFocus
              data-testid="issue-type-parent-input"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => {
                  setSubtaskTypeId(null);
                  setParentValue('');
                }}
              >
                뒤로
              </Button>
              <Button
                size="sm"
                type="submit"
                disabled={!parentValid || update.isPending}
                data-testid="issue-type-parent-save"
              >
                저장
              </Button>
            </div>
          </form>
        ) : (
          <ul className="space-y-0.5" role="radiogroup" aria-label="이슈 유형 선택">
            {(types.data ?? []).map((t) => {
              const checked = t.id === current.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    className={cn(
                      'w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-accent',
                      checked && SELECTED_ROW_CLASS,
                    )}
                    data-testid={`issue-type-option-${t.id}`}
                    onClick={() => {
                      if (checked) return onOpenChange(false);
                      // SUBTASK 는 부모 없이 될 수 없다 — 부모 번호 단계로 넘어간다.
                      if (t.name === 'SUBTASK') return setSubtaskTypeId(t.id);
                      update.mutate({ typeId: t.id });
                      onOpenChange(false);
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
        )}
      </PopoverContent>
    </Popover>
  );
}
