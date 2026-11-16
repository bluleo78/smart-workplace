// 마일스톤 다이아몬드 클릭 시 앵커 위치에 뜨는 편집 팝오버 — 이름/날짜 인라인 수정 + 연결 이슈 보기 + 삭제.
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { Input } from '@/components/ui/input';
import { isIncompleteDateInput } from '@/lib/dateInput';
import { isEscapeForInnerOverlay } from '@/lib/escapeOverlay';

import { useDeleteMilestone, useUpdateMilestone } from '../../../hooks/queries/useMilestones';
import type { MilestoneResponse } from '../../../types/milestone';

/** 마감일을 덜 넣은 채 칸을 벗어났을 때 칸 아래에 보이는 안내(WP-1644). */
const INCOMPLETE_DUE_DATE_MESSAGE = '날짜를 끝까지 입력해 주세요.';
/** 안내 문구 요소 id — 마감일 칸의 aria-describedby 연결용. */
const DUE_DATE_ERROR_ID = 'milestone-popover-due-date-error';

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

  // 마감일 「덜 넣음」 안내(WP-1644, 판정 이유는 lib/dateInput) — 가리지 않으면 「비울 수 없습니다」 토스트와 함께 치던 값이 지워진다.
  const [dueIncomplete, setDueIncomplete] = useState(false);
  const dueInputRef = useRef<HTMLInputElement | null>(null);
  /**
   * 팝오버 닫기(바깥 클릭·Esc·닫기 단추) — 마감일을 덜 넣은 채 닫으면 칸 아래 안내는 팝오버와 함께 사라져 저장됐는지 알 수 없으므로
   * 저장하지 않았다는 토스트를 남긴다(WP-1644). 바깥 클릭은 blur 다음에 오므로 이때도 칸은 덜 넣은 그대로다.
   */
  const close = () => {
    if (isIncompleteDateInput(dueInputRef.current)) toast.error('마감일을 끝까지 넣지 않아 저장하지 않았습니다.');
    onClose();
  };
  /** 이미 선 안내를 거둔다 — 입력(change)·키 뗌(keyUp) 때 덜 넣음이 풀렸으면 끈다. */
  const recheckDueDate = (el: HTMLInputElement) => {
    if (!isIncompleteDateInput(el)) setDueIncomplete(false);
  };

  // 바깥 클릭(backdrop)만 닫기를 처리하고 있어 Esc 로는 닫히지 않던 문제 — shadcn Popover/Dialog 관례에 맞춘다.
  // 삭제 확인 창 등 안쪽 오버레이가 열려 있으면 그 Esc 는 그것만 닫는다(WP-698 — 팝오버까지 함께 닫히던 문제).
  const popoverRef = useRef<HTMLDivElement>(null);
  // Esc 처리기는 한 번만 달고 그때그때 최신 close 를 부른다 — close 는 그릴 때마다 새로 만들어진다.
  const closeOnEscape = useEffectEvent(close);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isEscapeForInnerOverlay(e, popoverRef.current)) closeOnEscape();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 저장이 거절되면(이름 중복 409 등) 입력칸을 서버 값으로 되돌린다(WP-615) — 입력칸은 defaultValue 라 그대로 두면 거절된 값이
  // 저장된 것처럼 남았다. 오류 토스트는 훅(useUpdateMilestone)이 띄운다.
  function saveField(patch: Partial<{ name: string; dueDate: string }>, revert: () => void) {
    update.mutate(
      {
        id: milestone.id,
        body: {
          name: milestone.name,
          dueDate: milestone.dueDate,
          description: milestone.description ?? undefined,
          ...patch,
        },
      },
      { onError: revert },
    );
  }

  // 팝오버 예상 높이 기준으로 아래쪽 공간이 부족하면 앵커 위로 뒤집어 화면 밖으로 밀리지 않게 한다.
  // 마감일 「덜 넣음」 안내 한 줄(약 28px)까지 넣은 높이 — 안내가 떠도 화면 아래로 넘치지 않고, 뜰 때 팝오버가 움직이지 않게 늘 같은 값을 쓴다(WP-1644).
  const ESTIMATED_HEIGHT = 288;
  const openUpward = anchorRect.bottom + ESTIMATED_HEIGHT > window.innerHeight;
  const top = openUpward ? Math.max(8, anchorRect.top - ESTIMATED_HEIGHT) : anchorRect.bottom + 4;
  const left = Math.min(anchorRect.left, window.innerWidth - 272);

  return (
    <>
      {/* 팝오버 바깥 클릭 시 닫기 — 앵커가 실제 DOM 트리거가 아니라(anchorRect 좌표) 별도 backdrop 으로 처리 */}
      <div className="fixed inset-0 z-40" onClick={close} />
      <div
        ref={popoverRef}
        role="dialog"
        aria-label="마일스톤 편집"
        data-testid="milestone-edit-popover"
        className="bg-popover text-popover-foreground fixed z-50 w-64 space-y-3 rounded-md border p-4 shadow-md"
        style={{ top, left }}
        onClick={(e) => e.stopPropagation()}
      >
        <Input
          defaultValue={milestone.name}
          maxLength={100} // 서버 상한(CreateMilestoneRequest.name) — 수정도 같은 DTO(WP-687)
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
            const input = e.target;
            if (next !== milestone.name) saveField({ name: next }, () => (input.value = milestone.name));
          }}
        />
        <div className="space-y-2">
          <Input
            type="date"
            ref={dueInputRef}
            defaultValue={milestone.dueDate}
            aria-label="마감일"
            aria-invalid={dueIncomplete || undefined}
            aria-describedby={dueIncomplete ? DUE_DATE_ERROR_ID : undefined}
            data-testid="milestone-popover-due-date-input"
            onChange={(e) => recheckDueDate(e.currentTarget)}
            onKeyUp={(e) => recheckDueDate(e.currentTarget)}
            onBlur={(e) => {
              // 덜 넣은 날짜는 토스트·되돌리기·저장 모두 없이 안내만 세운다 — 사용자가 이어서 끝까지 넣을 수 있게 입력값을 그대로 둔다.
              if (isIncompleteDateInput(e.target)) {
                setDueIncomplete(true);
                return;
              }
              setDueIncomplete(false);
              if (!e.target.value) {
                // 빈 값으로는 저장하지 않음 — 조용히 무시하면 사용자가 저장 여부를 알 수 없으므로
                // 안내 후 화면 값을 서버 값으로 즉시 원복한다.
                toast.error('마감일은 비울 수 없습니다.');
                e.target.value = milestone.dueDate;
                return;
              }
              const input = e.target;
              if (input.value !== milestone.dueDate) {
                saveField({ dueDate: input.value }, () => (input.value = milestone.dueDate));
              }
            }}
          />
          {dueIncomplete && (
            <p id={DUE_DATE_ERROR_ID} role="alert" className="text-sm text-destructive">
              {INCOMPLETE_DUE_DATE_MESSAGE}
            </p>
          )}
        </div>
        <Link
          to={`/projects/${projectKey}?milestone=${milestone.id}`}
          className="text-primary block text-sm underline"
          data-testid="milestone-linked-issues-link"
        >
          연결된 이슈 {linkedCount}개 보기
        </Link>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={close}>
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
