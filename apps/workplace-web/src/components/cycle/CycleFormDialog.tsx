// 사이클 생성/수정 다이얼로그. cycle 이 주어지면 수정, 없으면 생성.
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { useCreateCycle, useUpdateCycle } from '../../hooks/queries/useCycles';
import { CYCLE_STATUS_LABEL, CYCLE_STATUSES, type CycleResponse, type CycleStatus } from '../../types/cycle';

export function CycleFormDialog({
  projectKey,
  cycle,
  open,
  onOpenChange,
}: {
  projectKey: string;
  cycle?: CycleResponse;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const create = useCreateCycle(projectKey);
  const update = useUpdateCycle(projectKey);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState<CycleStatus>('PLANNED');

  // 종료일이 시작일보다 빠른 경우만 오류 — 둘 중 하나라도 비어있으면 검증하지 않음(#804).
  const dateRangeInvalid = Boolean(startDate && endDate && endDate < startDate);

  useEffect(() => {
    if (open) {
      setName(cycle?.name ?? '');
      setGoal(cycle?.goal ?? '');
      setStartDate(cycle?.startDate ?? '');
      setEndDate(cycle?.endDate ?? '');
      setStatus(cycle?.status ?? 'PLANNED');
    }
  }, [open, cycle]);

  function submit() {
    if (dateRangeInvalid) return;
    const body = {
      name: name.trim(),
      goal: goal.trim() || null,
      startDate: startDate || null,
      endDate: endDate || null,
      status,
    };
    const onDone = () => onOpenChange(false);
    if (cycle) update.mutate({ id: cycle.id, body }, { onSuccess: onDone });
    else create.mutate(body, { onSuccess: onDone });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="cycle-form-dialog">
        <DialogHeader>
          <DialogTitle>{cycle ? '사이클 수정' : '새 사이클'}</DialogTitle>
          <DialogDescription className="sr-only">{cycle ? '사이클 수정' : '새 사이클'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="사이클 이름"
            data-testid="cycle-name-input"
          />
          <Textarea
            placeholder="목표 (선택)"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            aria-label="사이클 목표"
          />
          <div className="flex gap-2">
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              aria-label="시작일"
            />
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              aria-label="종료일"
              aria-invalid={dateRangeInvalid}
            />
          </div>
          {dateRangeInvalid && (
            <p className="text-sm text-destructive" data-testid="cycle-date-range-error">
              종료일은 시작일 이후여야 합니다
            </p>
          )}
          {/* shadcn Select — native <select> 대신 사용(다크모드 스타일 일관성 #270) */}
          <Select value={status} onValueChange={(v) => setStatus(v as CycleStatus)}>
            <SelectTrigger
              className="w-full"
              aria-label="상태"
              data-testid="cycle-status-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CYCLE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {CYCLE_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={submit} disabled={!name.trim() || dateRangeInvalid} data-testid="cycle-submit">
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
