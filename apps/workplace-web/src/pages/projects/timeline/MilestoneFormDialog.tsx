// 마일스톤 생성/수정 다이얼로그. milestone 이 주어지면 수정, 없으면 생성(defaultDueDate 로 날짜 프리필 가능).
import { useEffect, useState } from 'react';

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
  const create = useCreateMilestone(projectKey);
  const update = useUpdateMilestone(projectKey);
  const [name, setName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (open) {
      setName(milestone?.name ?? '');
      setDueDate(milestone?.dueDate ?? defaultDueDate ?? '');
      setDescription(milestone?.description ?? '');
    }
  }, [open, milestone, defaultDueDate]);

  function submit() {
    const body = {
      name: name.trim(),
      dueDate,
      description: description.trim() || undefined,
    };
    const onDone = () => onOpenChange(false);
    if (milestone) update.mutate({ id: milestone.id, body }, { onSuccess: onDone });
    else create.mutate(body, { onSuccess: onDone });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="milestone-form-dialog">
        <DialogHeader>
          <DialogTitle>{milestone ? '마일스톤 수정' : '새 마일스톤'}</DialogTitle>
          <DialogDescription className="sr-only">
            {milestone ? '마일스톤 수정' : '새 마일스톤'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="마일스톤 이름"
            data-testid="milestone-name-input"
            autoFocus
          />
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-label="마감일"
            data-testid="milestone-due-date-input"
          />
          <Textarea
            placeholder="설명 (선택)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-label="마일스톤 설명"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            onClick={submit}
            disabled={!name.trim() || !dueDate}
            data-testid="milestone-submit"
          >
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
