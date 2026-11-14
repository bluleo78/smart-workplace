// 사이클 생성/수정 다이얼로그. cycle 이 주어지면 수정, 없으면 생성.
import { useEffect, useRef, useState } from 'react';

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/overlay/select';
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

import { useCreateCycle, useUpdateCycle } from '../../hooks/queries/useCycles';
import { isCycleDateMissing, isCycleDateRangeInvalid } from '../../lib/cycleMeta';
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
  // 저장 중복 제출 가드(WP-1554) — 빠른 두 번 클릭은 리렌더 전에 들어와 isPending 이 아직 false 일 수 있어
  // 동기적으로 읽히는 ref 로 실제 차단한다. 요청 promise 가 끝나면(성공·실패) 푼다.
  const submittingRef = useRef(false);
  // 저장 중에는 버튼을 잠가 사용자가 다시 누르지 않게 시각 반영한다(WP-1554).
  // 모드별로 해당 mutation 만 본다 — 수정 창이 생성 mutation 상태에 영향받지 않게.
  const saving = cycle ? update.isPending : create.isPending;

  // 기간은 필수(WP-1316) — 비어 있으면 저장을 잠그고 안내만 보인다(아직 입력 전이라 오류색은 쓰지 않는다).
  const dateMissing = isCycleDateMissing(startDate, endDate);
  // 종료일이 시작일보다 빠르면 오류(#804).
  const dateRangeInvalid = isCycleDateRangeInvalid(startDate, endDate);

  useEffect(() => {
    if (open) {
      setName(cycle?.name ?? '');
      setGoal(cycle?.goal ?? '');
      setStartDate(cycle?.startDate ?? '');
      setEndDate(cycle?.endDate ?? '');
      setStatus(cycle?.status ?? 'PLANNED');
    }
  }, [open, cycle]);

  // 저장 요청이 나가 있는 동안은 창을 닫지 못한다(WP-1554) — 닫고 다시 열어 재저장하면 성공+409 토스트가
  // 같이 뜨고, 늦게 온 onSuccess 가 다시 연 창을 닫는다. ESC·오버레이 닫기는 무시한다(폴더 선택창 WP-1527 과 같은 규칙).
  function handleOpenChange(o: boolean) {
    if (!o && saving) return;
    onOpenChange(o);
  }

  async function submit() {
    // 이미 저장 요청이 진행 중이면 무시 — 두 번째 POST 가 이름 중복 409 로 실패해 성공·오류 토스트가 같이 뜨던 문제(WP-1554).
    if (submittingRef.current) return;
    if (dateMissing || dateRangeInvalid) return;
    const body = {
      name: name.trim(),
      goal: goal.trim() || null,
      startDate,
      endDate,
      status,
    };
    submittingRef.current = true;
    // 가드는 렌더 타이밍이 아니라 요청 promise 가 끝나는 시점에 푼다(WP-1554) — 응답이 빨라 pending→idle 이
    // 한 번에 묶여 렌더되거나 observer 가 리셋돼도 mutateAsync promise 는 반드시 settle 된다.
    try {
      if (cycle) await update.mutateAsync({ id: cycle.id, body });
      else await create.mutateAsync(body);
      onOpenChange(false);
    } catch {
      // 실패 토스트는 훅의 onError 가 이미 띄운다 — 여기서는 처리되지 않은 rejection 만 막고 창·입력은 남긴다.
    } finally {
      submittingRef.current = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
            maxLength={60} // 서버 상한(CreateCycleRequest.name) — 넘긴 채 저장하면 400 이었다(WP-687)
            aria-label="사이클 이름"
            data-testid="cycle-name-input"
          />
          <Textarea
            placeholder="목표 (선택)"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            maxLength={2000} // 서버 상한(CreateCycleRequest.goal)
            aria-label="사이클 목표"
          />
          <div className="flex gap-2">
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              aria-label="시작일"
              required
            />
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              aria-label="종료일"
              aria-invalid={dateRangeInvalid}
              required
            />
          </div>
          {dateMissing && (
            <p className="text-sm text-muted-foreground" data-testid="cycle-date-required">
              시작일과 종료일을 모두 입력해 주세요
            </p>
          )}
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            취소
          </Button>
          <Button onClick={submit} disabled={!name.trim() || dateMissing || dateRangeInvalid || saving} data-testid="cycle-submit">
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
