// 사이클 완료 창(WP-1578, 시안 B안) — 진행 중 사이클을 끝내며 미완료 이슈를 보낼 곳(새 사이클 / 예정 사이클 / 없음)을
// 드롭다운 하나로 고른다. 새 사이클은 다음 이름·기간을 추천해 요약 한 줄로 보이고 「수정」을 눌러야 칸이 펼쳐진다.
// 서버가 한 요청·한 트랜잭션으로 완료+이동을 처리하므로(POST /cycles/{id}/complete) 실패하면 창을 남기고 오류를 창 안에 보인다.
import { useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/overlay/select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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

import { useCompleteCycle, useCycleProgress, useCycles } from '../../hooks/queries/useCycles';
import { extractApiError, isConflictError } from '../../lib/api-error';
import {
  defaultDestination,
  isCompleteBlocked,
  isNewCycleNameTooLong,
  nextCycleName,
  nextCyclePeriod,
  scheduledCyclesByStart,
} from '../../lib/cycleComplete';
import { CYCLE_NAME_MAX, isCycleDateRangeInvalid } from '../../lib/cycleMeta';
import type { CycleCompleteRequest, CycleProgress, CycleResponse } from '../../types/cycle';

/** 미완료 이슈를 보낼 곳 — 서버 destination 과 같은 세 갈래. 예정 사이클이면 고른 사이클 id 를 함께 든다. */
type Destination = { kind: 'NEW' } | { kind: 'SCHEDULED'; cycleId: number } | { kind: 'NONE' };

/**
 * 드롭다운 값 — 새 사이클 `new` / 예정 사이클 `cycle:<id>` / 없음 `none`.
 * Select 는 문자열 값만 다루므로 보낼 곳 ↔ 값 변환을 아래 두 함수에만 둔다(화면 곳곳에서 문자열을 다시 풀지 않게).
 */
const NEW_VALUE = 'new';
const NONE_VALUE = 'none';
const CYCLE_VALUE_PREFIX = 'cycle:';

function toSelectValue(d: Destination): string {
  if (d.kind === 'NEW') return NEW_VALUE;
  if (d.kind === 'NONE') return NONE_VALUE;
  return `${CYCLE_VALUE_PREFIX}${d.cycleId}`;
}

function fromSelectValue(value: string): Destination {
  if (value === NEW_VALUE) return { kind: 'NEW' };
  if (value === NONE_VALUE) return { kind: 'NONE' };
  return { kind: 'SCHEDULED', cycleId: Number(value.slice(CYCLE_VALUE_PREFIX.length)) };
}

/**
 * 기간 문구 — 「yyyy-MM-dd ~ yyyy-MM-dd」(시안·사이클 목록 데스크톱 행과 같은 모양).
 * lib/formatters 의 formatDateRangeMonthDay 는 「11월 3일 ~」처럼 월·일만 보여 시안과 달라 쓰지 않는다. 둘 다 없으면 null(호출부가 기간을 빼고 이슈 수만 보인다), 한쪽만 있으면 목록 행처럼 「—」. */
function periodText(startDate: string | null, endDate: string | null): string | null {
  if (!startDate && !endDate) return null;
  return `${startDate || '—'} ~ ${endDate || '—'}`;
}

/** 빈 조각은 빼고 「 · 」로 잇는다 — 기간이 없을 때 「 · 이슈 n개」처럼 앞에 점이 남지 않게. */
function joinDot(...parts: (string | null)[]): string {
  return parts.filter((p): p is string => !!p).join(' · ');
}

/**
 * 드롭다운 항목 한 줄 — 이름 아래 작은 글씨(기간·이슈 수)를 둔다. 새 사이클 항목과 예정 사이클 항목이 함께 쓴다.
 * 이름과 보조 글자가 붙어 읽히지 않게(「새 사이클GW-8」) 화면 읽기에만 이름 끝에 쉼표를 둔다.
 */
function DestinationOption({ name, subline }: { name: string; subline: string }) {
  return (
    <span className="flex flex-col items-start">
      <span>
        {name}
        <span className="sr-only">,</span>
      </span>
      <span className="text-xs text-muted-foreground">{subline}</span>
    </span>
  );
}

/**
 * 사이클 완료 창.
 *
 * - 창 안 상태(보낼 곳·새 사이클 입력·오류)는 `CompleteBody` 가 갖는다 — DialogContent 는 닫히면 언마운트되므로
 *   닫았다 다시 열면 추천값으로 처음부터 시작한다.
 * - 완료 요청이 나가 있는 동안은 닫히지 않는다(사이클 생성 창 WP-1554 와 같은 규칙 — 늦게 온 응답이 다시 연 창을 닫지 않게).
 */
export function CycleCompleteDialog({
  projectKey,
  cycle,
  open,
  onOpenChange,
}: {
  projectKey: string;
  cycle: CycleResponse | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const complete = useCompleteCycle(projectKey);

  function handleOpenChange(o: boolean) {
    if (!o && complete.isPending) return;
    onOpenChange(o);
  }

  return (
    <Dialog open={open && cycle != null} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="cycle-complete-dialog">
        {cycle && (
          <CompleteBody
            projectKey={projectKey}
            cycle={cycle}
            saving={complete.isPending}
            onSubmit={(body) => complete.mutateAsync({ cycleId: cycle.id, body })}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 창 본문 — 열릴 때마다 새로 마운트되어 추천값(다음 이름·기간, 기본 보낼 곳)으로 상태를 잡는다. */
function CompleteBody({
  projectKey,
  cycle,
  saving,
  onSubmit,
  onDone,
}: {
  projectKey: string;
  cycle: CycleResponse;
  saving: boolean;
  onSubmit: (body: CycleCompleteRequest) => Promise<unknown>;
  onDone: () => void;
}) {
  const cycles = useCycles(projectKey);
  const progress = useCycleProgress(projectKey);
  // 사이클별 진행 집계 — 드롭다운 항목마다 찾으므로 한 번 Map 으로 만들어 둔다.
  const progressById = useMemo(
    () => new Map<number, CycleProgress>((progress.data ?? []).map((p) => [p.cycleId, p])),
    [progress.data],
  );

  // 진행 집계를 받기 전(또는 실패)에는 미완료 수를 모른다 — 0 으로 보고 「없음」으로 완료해 버리면 되돌릴 수 없으므로
  // 집계가 올 때까지 칸·보낼 곳을 그리지 않고 완료를 막는다. 사이클 목록도 같다 — 받기 전에는 예정 사이클을 몰라 기본 보낼 곳이
  // 조용히 「새 사이클」로 잡힌다. 둘 다 와야 그린다.
  const dataReady = progress.isSuccess && cycles.isSuccess;
  const dataLoading = (progress.isPending || cycles.isPending) && !progress.isError && !cycles.isError;
  const dataError = progress.isError || cycles.isError;
  // 완료(done) 기준은 진행 막대와 같다 — DONE+취소. 미완료 = total − done.
  const own = progressById.get(cycle.id);
  const total = own?.total ?? 0;
  const done = own?.done ?? 0;
  const incomplete = Math.max(0, total - done);

  // 예정 사이클은 시작일 순 — 드롭다운 「예정 사이클」 묶음과 기본 보낼 곳(가장 이른 것)이 같은 순서를 쓴다.
  const scheduled = useMemo(() => scheduledCyclesByStart(cycles.data ?? []), [cycles.data]);

  // 추천 다음 이름·기간 — 끝 숫자가 없거나 기간이 없으면 추천할 수 없어 처음부터 칸을 펼쳐 직접 입력받는다.
  const [suggestedName] = useState(() => nextCycleName(cycle.name));
  const [suggestedPeriod] = useState(() => nextCyclePeriod(cycle.startDate, cycle.endDate));
  // 사용자가 고른 보낼 곳 — 고르기 전(null)에는 지금 목록으로 기본값을 계산해, 목록이 늦게 와도 기본값이 맞게 한다.
  const [chosen, setChosen] = useState<Destination | null>(null);
  const dest: Destination = chosen ?? defaultDestination(scheduled);
  const [newName, setNewName] = useState(suggestedName);
  const [newStart, setNewStart] = useState(suggestedPeriod?.startDate ?? '');
  const [newEnd, setNewEnd] = useState(suggestedPeriod?.endDate ?? '');
  // 추천 이름이 상한을 넘으면(60자 이름 끝 '9' → 61자) 요약 줄로 숨기지 않고 칸을 펼쳐 이름 칸 아래에 알린다.
  const [editingNew, setEditingNew] = useState(
    suggestedName === '' || suggestedPeriod == null || isNewCycleNameTooLong(suggestedName),
  );
  const [startImmediately, setStartImmediately] = useState(true);
  // 서버 오류 — 이름 중복(409)은 이름 칸 아래, 그 밖은 완료 버튼 위.
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // 같은 틱 두 번 클릭 가드(WP-1554 와 같은 이유) — isPending 은 다시 그린 뒤에야 true 라 ref 로 막는다.
  const submittingRef = useRef(false);
  const labelId = useId();

  // 미완료가 없으면 보낼 곳을 묻지 않고 「없음」으로 완료한다.
  const effectiveDest: Destination = incomplete === 0 ? { kind: 'NONE' } : dest;
  const target =
    effectiveDest.kind === 'SCHEDULED' ? scheduled.find((c) => c.id === effectiveDest.cycleId) : undefined;
  // 보낼 예정 사이클의 지금 이슈 수 — 요약 줄의 「n개 → n+미완료개」에 쓴다.
  const targetTotal = target ? (progressById.get(target.id)?.total ?? 0) : 0;

  const newRangeInvalid = isCycleDateRangeInvalid(newStart, newEnd);
  const nameTooLong = isNewCycleNameTooLong(newName);
  // 이름 칸 아래 문구 — 서버 오류(409)가 먼저, 없으면 길이 초과 안내.
  const nameMessage = nameError ?? (nameTooLong ? `사이클 이름은 ${CYCLE_NAME_MAX}자 이하로 입력하세요` : null);
  // 완료를 막을지 — 데이터 준비·요청 중·새 사이클 입력·예정 대상 판정은 순수 함수(lib/cycleComplete)가 맡는다.
  const blocked = isCompleteBlocked({
    dataReady,
    destination: effectiveDest.kind,
    hasTarget: target != null,
    newName,
    newStart,
    newEnd,
    pending: saving,
  });

  /** 고른 보낼 곳으로 요청 본문을 만든다 — 쓰지 않는 필드는 싣지 않는다. */
  function buildBody(): CycleCompleteRequest {
    if (effectiveDest.kind === 'NEW') {
      return {
        destination: 'NEW',
        newCycleName: newName.trim(),
        newCycleStartDate: newStart,
        newCycleEndDate: newEnd,
      };
    }
    if (target) return { destination: 'SCHEDULED', targetCycleId: target.id, startImmediately };
    return { destination: 'NONE' };
  }

  async function submit() {
    if (submittingRef.current || blocked) return;
    submittingRef.current = true;
    setFormError(null);
    setNameError(null);
    try {
      await onSubmit(buildBody());
      toast.success(`${cycle.name} 완료`);
      onDone();
    } catch (e) {
      // 훅은 토스트를 띄우지 않는다 — 창을 남기고 서버 메시지를 창 안에 보인다.
      if (isConflictError(e) && effectiveDest.kind === 'NEW') {
        // 이름 중복 — 요약 줄이었다면 칸을 펼쳐 이름 칸 아래에 보인다.
        setChosen({ kind: 'NEW' });
        setEditingNew(true);
        // 대체 문구는 서버(CycleNameDuplicatedException)와 같은 말로.
        setNameError(extractApiError(e, '이미 존재하는 사이클 이름입니다'));
      } else {
        setFormError(extractApiError(e, '사이클을 완료하지 못했습니다'));
      }
    } finally {
      submittingRef.current = false;
    }
  }

  const ownPeriod = periodText(cycle.startDate, cycle.endDate);
  const newPeriod = periodText(newStart || null, newEnd || null);
  // 트리거에 보일 글자 — 항목 아래 작은 글씨까지 트리거에 들어가지 않게 이름만.
  const triggerLabel =
    effectiveDest.kind === 'NEW' ? '새 사이클' : effectiveDest.kind === 'NONE' ? '사이클 없음' : (target?.name ?? '');

  return (
    <>
      <DialogHeader>
        <DialogTitle>{cycle.name} 완료</DialogTitle>
        <DialogDescription>{joinDot(ownPeriod, `이슈 ${total}개`)}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {dataLoading && (
          <p className="text-sm text-muted-foreground" data-testid="cycle-complete-progress-loading">
            이슈 현황을 불러오는 중입니다…
          </p>
        )}
        {dataError && (
          <p className="text-sm text-destructive" data-testid="cycle-complete-progress-error">
            이슈 현황을 불러오지 못했습니다. 창을 닫고 다시 시도해 주세요.
          </p>
        )}
        {/* 완료 / 미완료 두 칸 — 집계가 온 뒤에만(0/0 으로 잘못 보이지 않게) */}
        {dataReady && (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border p-3" data-testid="cycle-complete-done">
              <div className="text-xl font-semibold">{done}</div>
              <div className="text-xs text-muted-foreground">완료</div>
            </div>
            <div className="rounded-lg border p-3" data-testid="cycle-complete-incomplete">
              <div className="text-xl font-semibold">{incomplete}</div>
              <div className="text-xs text-muted-foreground">미완료</div>
            </div>
          </div>
        )}

        {dataReady && incomplete > 0 && (
          <div className="space-y-2">
            <Label id={labelId}>미완료 이슈 {incomplete}개 보낼 곳</Label>
            <Select value={toSelectValue(dest)} onValueChange={(v) => setChosen(fromSelectValue(v))} disabled={saving}>
              <SelectTrigger className="w-full" aria-labelledby={labelId} data-testid="cycle-complete-destination">
                <SelectValue>{triggerLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={toSelectValue({ kind: 'NEW' })}>
                  <DestinationOption name="새 사이클" subline={joinDot(newName.trim() || null, newPeriod)} />
                </SelectItem>
                {scheduled.length > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>예정 사이클</SelectLabel>
                      {scheduled.map((c) => (
                        <SelectItem key={c.id} value={toSelectValue({ kind: 'SCHEDULED', cycleId: c.id })}>
                          <DestinationOption
                            name={c.name}
                            subline={joinDot(
                              periodText(c.startDate, c.endDate),
                              `이슈 ${progressById.get(c.id)?.total ?? 0}개`,
                            )}
                          />
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                )}
                <SelectSeparator />
                <SelectItem value={toSelectValue({ kind: 'NONE' })}>사이클 없음</SelectItem>
              </SelectContent>
            </Select>

            {effectiveDest.kind === 'NEW' &&
              (editingNew ? (
                <div className="space-y-3 rounded-lg border p-3">
                  <div className="space-y-1">
                    <Label htmlFor={`${labelId}-name`} className="text-xs text-muted-foreground">이름</Label>
                    <Input
                      id={`${labelId}-name`}
                      value={newName}
                      onChange={(e) => {
                        setNewName(e.target.value);
                        setNameError(null);
                      }}
                      maxLength={CYCLE_NAME_MAX} // 서버 상한(CycleCompleteRequest.newCycleName @Size 60)
                      aria-label="새 사이클 이름"
                      aria-invalid={nameMessage != null}
                      aria-describedby={nameMessage ? `${labelId}-name-error` : undefined}
                    />
                    {nameMessage && (
                      <p
                        id={`${labelId}-name-error`}
                        className="text-sm text-destructive"
                        data-testid="cycle-complete-name-error"
                      >
                        {nameMessage}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">기간</span>
                    <div className="flex items-center gap-2">
                      <Input
                        type="date"
                        value={newStart}
                        onChange={(e) => setNewStart(e.target.value)}
                        aria-label="새 사이클 시작일"
                      />
                      <span className="text-muted-foreground">~</span>
                      <Input
                        type="date"
                        value={newEnd}
                        onChange={(e) => setNewEnd(e.target.value)}
                        aria-label="새 사이클 종료일"
                        aria-invalid={newRangeInvalid}
                      />
                    </div>
                    {newRangeInvalid && (
                      <p className="text-sm text-destructive">종료일은 시작일 이후여야 합니다</p>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">새 사이클은 바로 진행 중으로 시작합니다.</p>
                </div>
              ) : (
                <div
                  className="flex items-start justify-between gap-2 rounded-lg border p-3"
                  data-testid="cycle-complete-summary"
                >
                  <div className="min-w-0">
                    <div className="font-medium break-words">{newName}</div>
                    <div className="text-xs text-muted-foreground">{joinDot(newPeriod, '바로 진행 중')}</div>
                  </div>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto shrink-0 p-0 text-foreground underline"
                    onClick={() => setEditingNew(true)}
                  >
                    수정
                  </Button>
                </div>
              ))}

            {target && (
              <>
                <div className="rounded-lg border p-3" data-testid="cycle-complete-summary">
                  <div className="font-medium break-words">{target.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {joinDot(
                      periodText(target.startDate, target.endDate),
                      `이슈 ${targetTotal}개 → ${targetTotal + incomplete}개`,
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`${labelId}-start`}
                    checked={startImmediately}
                    onCheckedChange={(v) => setStartImmediately(v === true)}
                  />
                  <Label htmlFor={`${labelId}-start`} className="font-normal">
                    {target.name} 바로 시작
                  </Label>
                </div>
              </>
            )}

            {effectiveDest.kind === 'NONE' && (
              <p className="text-xs text-muted-foreground">미완료 이슈는 백로그에서 볼 수 있습니다.</p>
            )}
          </div>
        )}

        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={saving}>
          취소
        </Button>
        <Button onClick={submit} disabled={blocked} data-testid="cycle-complete-submit">
          완료
        </Button>
      </DialogFooter>
    </>
  );
}
