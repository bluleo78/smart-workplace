// 마일스톤 다이아몬드 클릭 시 앵커 위치에 뜨는 편집 팝오버 — 이름/날짜 인라인 수정 + 연결 이슈 보기 + 삭제.
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { Input } from '@/components/ui/input';

import { useDeleteMilestone, useUpdateMilestone } from '../../../hooks/queries/useMilestones';
import type { MilestoneResponse } from '../../../types/milestone';

interface MilestoneEditPopoverProps {
  projectKey: string;
  milestone: MilestoneResponse;
  linkedCount: number;
  anchorRect: DOMRect;
  onClose: () => void;
}

export function MilestoneEditPopover({
  projectKey,
  milestone,
  linkedCount,
  anchorRect,
  onClose,
}: MilestoneEditPopoverProps) {
  const update = useUpdateMilestone(projectKey);
  const remove = useDeleteMilestone(projectKey);

  // 바깥 클릭(backdrop)만 닫기를 처리하고 있어 Esc 로는 닫히지 않던 문제 — shadcn Popover/Dialog 관례에 맞춘다.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function saveField(patch: Partial<{ name: string; dueDate: string }>) {
    update.mutate({
      id: milestone.id,
      body: {
        name: milestone.name,
        dueDate: milestone.dueDate,
        description: milestone.description ?? undefined,
        ...patch,
      },
    });
  }

  // 팝오버 예상 높이(~260px) 기준으로 아래쪽 공간이 부족하면 앵커 위로 뒤집어 화면 밖으로 밀리지 않게 한다.
  const ESTIMATED_HEIGHT = 260;
  const openUpward = anchorRect.bottom + ESTIMATED_HEIGHT > window.innerHeight;
  const top = openUpward ? Math.max(8, anchorRect.top - ESTIMATED_HEIGHT) : anchorRect.bottom + 4;
  const left = Math.min(anchorRect.left, window.innerWidth - 272);

  return (
    <>
      {/* 팝오버 바깥 클릭 시 닫기 — 앵커가 실제 DOM 트리거가 아니라(anchorRect 좌표) 별도 backdrop 으로 처리 */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        role="dialog"
        aria-label="마일스톤 편집"
        data-testid="milestone-edit-popover"
        className="bg-popover text-popover-foreground fixed z-50 w-64 space-y-3 rounded-md border p-4 shadow-md"
        style={{ top, left }}
        onClick={(e) => e.stopPropagation()}
      >
        <Input
          defaultValue={milestone.name}
          aria-label="마일스톤 이름"
          data-testid="milestone-popover-name-input"
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (!next) {
              // 빈 값으로는 저장하지 않음 — 조용히 무시하면 사용자가 저장 여부를 알 수 없으므로
              // 안내 후 화면 값을 서버 값으로 즉시 원복한다.
              toast.error('마일스톤 이름은 비울 수 없습니다.');
              e.target.value = milestone.name;
              return;
            }
            if (next !== milestone.name) saveField({ name: next });
          }}
        />
        <Input
          type="date"
          defaultValue={milestone.dueDate}
          aria-label="마감일"
          data-testid="milestone-popover-due-date-input"
          onBlur={(e) => {
            if (!e.target.value) {
              // 빈 값으로는 저장하지 않음 — 조용히 무시하면 사용자가 저장 여부를 알 수 없으므로
              // 안내 후 화면 값을 서버 값으로 즉시 원복한다.
              toast.error('마감일은 비울 수 없습니다.');
              e.target.value = milestone.dueDate;
              return;
            }
            if (e.target.value !== milestone.dueDate) {
              saveField({ dueDate: e.target.value });
            }
          }}
        />
        <Link
          to={`/projects/${projectKey}?milestone=${milestone.id}`}
          className="text-primary block text-sm underline"
          data-testid="milestone-linked-issues-link"
        >
          연결된 이슈 {linkedCount}개 보기
        </Link>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            닫기
          </Button>
          <DeleteConfirmDialog
            entityName="마일스톤"
            itemName={milestone.name}
            description={`"${milestone.name}" 마일스톤을 삭제하면 연결된 이슈 ${linkedCount}개의 연결이 해제됩니다. 이 작업은 되돌릴 수 없습니다.`}
            onConfirm={() => remove.mutate(milestone.id, { onSuccess: onClose })}
            trigger={
              <Button variant="destructive" size="sm" data-testid="milestone-delete-trigger">
                삭제
              </Button>
            }
          />
        </div>
      </div>
    </>
  );
}
