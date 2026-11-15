// 마일스톤 생성/수정 다이얼로그. milestone 이 주어지면 수정, 없으면 생성(defaultDueDate 로 날짜 프리필 가능).
import { useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { useCreateMilestone, useUpdateMilestone } from '../../../hooks/queries/useMilestones';
import type { MilestoneResponse } from '../../../types/milestone';

interface MilestoneFormDialogProps {
  projectKey: string;
  milestone?: MilestoneResponse;
  /** 레인 빈곳 클릭으로 생성할 때 클릭 날짜를 프리필한다. */
  defaultDueDate?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MilestoneFormDialog({
  projectKey,
  milestone,
  defaultDueDate,
  open,
  onOpenChange,
}: MilestoneFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="milestone-form-dialog">
        <DialogHeader>
          <DialogTitle>{milestone ? '마일스톤 수정' : '새 마일스톤'}</DialogTitle>
          <DialogDescription className="sr-only">
            {milestone ? '마일스톤 수정' : '새 마일스톤'}
          </DialogDescription>
        </DialogHeader>
        {/* 폼은 창이 열릴 때마다 새로 마운트돼(DialogContent) 첫 그림부터 값이 채워진다 —
            열린 뒤 effect 로 채우면 수정·날짜 프리필 창에서 빈 값 안내가 한 번 깜빡였다(WP-1556). */}
        <MilestoneForm
          projectKey={projectKey}
          milestone={milestone}
          defaultDueDate={defaultDueDate}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** 마일스톤 입력 칸·저장 단추 — 처음 그릴 때 받은 값으로 상태를 시작한다. */
function MilestoneForm({
  projectKey,
  milestone,
  defaultDueDate,
  onClose,
}: Omit<MilestoneFormDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const create = useCreateMilestone(projectKey);
  const update = useUpdateMilestone(projectKey);
  const [name, setName] = useState(milestone?.name ?? '');
  const [dueDate, setDueDate] = useState(milestone?.dueDate ?? defaultDueDate ?? '');
  const [description, setDescription] = useState(milestone?.description ?? '');
  const dueDateId = useId();
  const dueDateHintId = `${dueDateId}-hint`;
  // 저장 단추의 잠금 조건(WP-1616) — 단추와 submit() 이 같이 쓴다.
  const canSubmit = name.trim().length > 0 && dueDate !== '' && !create.isPending && !update.isPending;
  // 중복 제출 가드 — Enter 두 번·Enter+클릭이 isPending 이 그려지기 전에 들어와도 한 번만 보낸다(사이클 창 WP-1554 와 같은 방식).
  const submittingRef = useRef(false);

  function submit() {
    if (submittingRef.current || !canSubmit) return;
    submittingRef.current = true;
    const body = {
      name: name.trim(),
      dueDate,
      description: description.trim() || undefined,
    };
    // 성공·실패 어느 쪽이든 끝나면 가드를 푼다 — 실패하면 창·입력이 남아 다시 저장할 수 있어야 한다.
    const options = { onSuccess: onClose, onSettled: () => { submittingRef.current = false; } };
    if (milestone) update.mutate({ id: milestone.id, body }, options);
    else create.mutate(body, options);
  }

  return (
    // 이름 칸 Enter 로도 저장되게 form 으로 감싼다(WP-1616). contents 라 DialogContent 의 grid 간격은 그대로다.
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="space-y-3">
        <Input
          placeholder="이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100} // 서버 상한(CreateMilestoneRequest.name)과 같다 — 넘긴 채 저장하면 400 이었다(WP-687)
          aria-label="마일스톤 이름"
          data-testid="milestone-name-input"
          autoFocus
        />
        {/* 마감일은 서버 필수(CreateMilestoneRequest.dueDate @NotNull) — * 와 빈 값 안내로 알린다. 사이클 창과 같은 방식(WP-1556). */}
        <div className="space-y-1">
          <Label htmlFor={dueDateId}>
            마감일 <span aria-hidden="true" className="text-destructive">*</span>
          </Label>
          <Input
            id={dueDateId}
            type="date"
            required
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-describedby={dueDate ? undefined : dueDateHintId}
            data-testid="milestone-due-date-input"
          />
          {!dueDate && (
            <p id={dueDateHintId} className="text-sm text-muted-foreground" data-testid="milestone-due-date-required">
              마감일을 입력해 주세요
            </p>
          )}
        </div>
        <Textarea
          placeholder="설명 (선택)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000} // 서버 상한(CreateMilestoneRequest.description)
          aria-label="마일스톤 설명"
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          취소
        </Button>
        <Button type="submit" disabled={!canSubmit} data-testid="milestone-submit">
          저장
        </Button>
      </DialogFooter>
    </form>
  );
}
