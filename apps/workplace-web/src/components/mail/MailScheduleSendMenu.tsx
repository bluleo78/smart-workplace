// 메일 예약 보내기 메뉴(WP-1787) — 쓰기 창 보내기 단추 옆 ▾(데스크톱)와 상단 바 ⋯(모바일).
// 프리셋(내일·월요일 오전 9시)을 고르면 바로 예약하고, 「날짜·시간 선택」은 datetime-local 대화상자로 받는다.
// 이 컴포넌트는 고른 시각만 onSchedule 로 넘긴다 — 보내기 준비·검증·요청은 쓰기 창(MailComposeDock)이 한다.
// 메뉴 항목이 시트·대화상자를 열 때는 메뉴가 다 닫힌 뒤(onCloseAutoFocus) 연다 — 같은 틱에 열면 Radix 가 초점을 메뉴 트리거로
// 돌려 방금 연 대화상자가 닫히거나 body 의 pointer-events 잠금이 남는다(useCloseSheetAfterMenu 와 같은 이유, 코드 리뷰).
import { CalendarClock, ChevronDown, Clock, EllipsisVertical } from 'lucide-react';
import { useRef, useState } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useFieldHint } from '@/hooks/useFieldHint';
import { isoToLocalInput } from '@/lib/calendar';
import { maxScheduleDate, minScheduleDate, type SchedulePreset, schedulePresets } from '@/lib/mailSchedule';
import { cn } from '@/lib/utils';

interface Props {
  /** 보내기를 막는 조건과 같다 — 꺼지면 ▾ 도 꺼진다. */
  disabled: boolean;
  /** 고른 예약 시각 — 호출한 쪽이 보내기와 같은 길로 sendAt 을 실어 보낸다. */
  onSchedule: (at: Date) => void;
  /** dock = 데스크톱 ▾ 메뉴(보내기 단추 오른쪽 묶음), mobile = 상단 바 ⋯ → 아래서 올라오는 시트. */
  variant: 'dock' | 'mobile';
}

/** Date → datetime-local 값(로컬 시각 「YYYY-MM-DDTHH:mm」) — 일정 폼과 같은 공용 변환(isoToLocalInput)을 쓴다. */
function toLocalInputValue(d: Date): string {
  return isoToLocalInput(d.toISOString());
}

/** 프리셋 한 줄 — 시계 아이콘, 라벨, 흐린 날짜. */
function PresetBody({ preset }: { preset: SchedulePreset }) {
  return (
    <>
      <Clock aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{preset.label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{preset.dateLabel}</span>
    </>
  );
}

/** 모바일 시트의 한 줄 — 44px 터치 높이. */
const sheetRowClass = 'flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left text-base hover:bg-accent';

/** 고르는 사이 보내기가 잠겼을 때(첨부 업로드 시작 등) 안내 — 창을 닫지 않고 이 문구를 보인다. */
const BLOCKED_MESSAGE = '지금은 예약할 수 없어요. 첨부 올리기 등이 끝나면 다시 눌러 주세요';

/** 잠김 안내 한 줄 — 대화상자·시트·메뉴가 같은 모양으로 보인다. */
function BlockedNote({ className }: { className?: string }) {
  return (
    <p role="alert" data-testid="mail-schedule-blocked" className={cn('text-xs text-destructive', className)}>
      {BLOCKED_MESSAGE}
    </p>
  );
}

export function MailScheduleSendMenu({ disabled, onSchedule, variant }: Props) {
  // 메뉴를 열 때의 시각 — 프리셋·최소 시각이 열린 순간 기준이 되게 열 때마다 다시 잡는다.
  const [now, setNow] = useState(() => new Date());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [value, setValue] = useState('');
  // 확인 시점에 최소 시각 미달로 막혔는지 — 대화상자를 오래 열어 둔 사이 최소 시각이 지나간 경우.
  const [stale, setStale] = useState(false);
  // 누른 순간 보내기가 잠겨 있어 예약하지 못했는지 — 창을 닫지 않고 안내한다(조용히 닫히고 아무 일도 없지 않게).
  const [blocked, setBlocked] = useState(false);
  // 메뉴 항목이 고른, 메뉴가 닫힌 뒤 열 것 — onCloseAutoFocus 가 꺼내 연다.
  const pendingOpen = useRef<'sheet' | 'dialog' | null>(null);

  const presets = schedulePresets(now);
  const min = minScheduleDate(now);
  const max = maxScheduleDate(now);
  const minValue = toLocalInputValue(min);
  const maxValue = toLocalInputValue(max);
  // 입력이 비었거나(덜 넣음) 최소 시각보다 이르거나 1년보다 멀면 예약할 수 없다.
  const picked = value ? new Date(value) : null;
  const pickedOk = picked != null && !Number.isNaN(picked.getTime());
  const tooFar = pickedOk && picked.getTime() > max.getTime();
  const valid = pickedOk && picked.getTime() >= min.getTime() && !tooFar;
  // 지금 띄울 검증 안내 — 1년보다 멀면 그 안내, 아니면 덜 넣었거나 지난 값이거나 확인하는 사이 최소 시각이 지났을 때
  // 「2분 뒤 이후」 안내. 둘 다 아니면 null(안내 없음). 조건을 글자 하나로 모아 칸 연결(aria)과 리전 내용이 어긋나지 않게 한다.
  const scheduleHint = tooFar
    ? '지금부터 1년 안으로 골라 주세요'
    : (!valid && value !== '') || stale
      ? '지금부터 2분 뒤 이후로 골라 주세요'
      : null;
  const hint = useFieldHint(scheduleHint != null);

  const refreshNow = () => {
    setNow(new Date());
    setBlocked(false);
  };
  // 프리셋 — 누른 순간 보내기가 잠겼으면 보내지 않고 안내만 한다(시트·메뉴는 열어 둔다). true 면 예약했다.
  const pickPreset = (p: SchedulePreset): boolean => {
    if (disabled) {
      setBlocked(true);
      return false;
    }
    setSheetOpen(false);
    onSchedule(p.at);
    return true;
  };
  // 메뉴가 다 닫힌 뒤 — 메뉴 항목이 예약해 둔 시트·대화상자를 연다. 초점 복귀를 막아 새로 연 창에서 초점이 빠져나가지 않게 한다.
  const onMenuCloseAutoFocus = (e: Event) => {
    const target = pendingOpen.current;
    pendingOpen.current = null;
    if (!target) return;
    e.preventDefault();
    if (target === 'sheet') {
      setBlocked(false);
      setSheetOpen(true);
    } else {
      openDialog();
    }
  };
  const openDialog = () => {
    const t = new Date();
    setNow(t);
    // 처음 값은 내일 오전 9시 — 바로 「예약」을 눌러도 합리적인 시각이 되게.
    setValue(toLocalInputValue(schedulePresets(t)[0].at));
    setSheetOpen(false);
    setStale(false);
    setBlocked(false);
    setDialogOpen(true);
  };
  const confirm = () => {
    if (!valid || !picked) return;
    // 열어 둔 사이 보내기가 잠겼을 수 있다(첨부 업로드 시작 등) — 닫지 않고 안내해, 예약된 줄 알았는데 아무 일도 없지 않게.
    if (disabled) {
      setBlocked(true);
      return;
    }
    // 열어 둔 사이 시간이 흘렀을 수 있다 — 누른 시점의 최소 시각으로 다시 확인해, 미달이면 닫지 않고 안내한다.
    const t = new Date();
    if (picked.getTime() < minScheduleDate(t).getTime()) {
      setNow(t);
      setStale(true);
      return;
    }
    setDialogOpen(false);
    onSchedule(picked);
  };

  const dialog = (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>날짜·시간 선택</DialogTitle>
          <DialogDescription>이 시각에 메일이 나가요. 나가기 전에는 예약 취소로 돌려받을 수 있어요.</DialogDescription>
        </DialogHeader>
        <Input
          type="datetime-local"
          data-testid="mail-schedule-datetime"
          aria-label="예약 시각"
          {...hint.inputProps}
          min={minValue}
          max={maxValue}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setStale(false);
            setBlocked(false);
          }}
        />
        {/* 예약 시각 검증 실패는 입력하는 도중에 뜨는 안내라 polite 로 읽히게 한다(WP-1901 리뷰) — role=alert 는 제출 실패에만. */}
        <FieldError id={hint.id} className="text-xs">
          {scheduleHint}
        </FieldError>
        {blocked && <BlockedNote />}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
            취소
          </Button>
          <Button type="button" data-testid="mail-schedule-confirm" disabled={!valid} onClick={confirm}>
            예약
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (variant === 'mobile') {
    return (
      <>
        {/* ⋯ — 상단 바의 곁 동작(44px). 누르면 「예약 보내기」 한 항목의 메뉴가 열린다. */}
        <DropdownMenu onOpenChange={(o) => o && refreshNow()}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="더보기"
              title="더보기"
              data-testid="mail-compose-schedule-trigger"
              disabled={disabled}
              className="flex h-11 w-11 shrink-0 items-center justify-center text-foreground disabled:text-muted-foreground disabled:opacity-60"
            >
              <EllipsisVertical className="h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onCloseAutoFocus={onMenuCloseAutoFocus}>
            <DropdownMenuItem
              className="min-h-11"
              onSelect={() => {
                pendingOpen.current = 'sheet';
              }}
            >
              <CalendarClock className="size-4" />
              예약 보내기
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent
            side="bottom"
            showCloseButton={false}
            data-testid="mail-schedule-sheet"
            className="max-h-[85dvh] gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]"
          >
            <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-muted-foreground/30" />
            <SheetTitle className="px-4 pt-2 text-center text-base">예약 보내기</SheetTitle>
            <SheetDescription className="sr-only">보낼 시각을 고르세요</SheetDescription>
            <div className="py-1">
              {presets.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  data-testid={`mail-schedule-preset-${p.key}`}
                  className={sheetRowClass}
                  onClick={() => pickPreset(p)}
                >
                  <PresetBody preset={p} />
                </button>
              ))}
              {blocked && <BlockedNote className="px-4 py-1" />}
              <div className="border-t" />
              <button type="button" data-testid="mail-schedule-custom" className={sheetRowClass} onClick={openDialog}>
                <CalendarClock aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                날짜·시간 선택
              </button>
            </div>
          </SheetContent>
        </Sheet>
        {dialog}
      </>
    );
  }

  return (
    <>
      <DropdownMenu onOpenChange={(o) => o && refreshNow()}>
        <DropdownMenuTrigger asChild>
          {/* 보내기 단추 오른쪽에 붙는 ▾ — 같은 주 색, 왼쪽에 얇은 구분선(한 묶음 버튼). */}
          <button
            type="button"
            aria-label="예약 보내기"
            title="예약 보내기"
            data-testid="mail-compose-schedule-trigger"
            disabled={disabled}
            className={cn(
              'flex items-center rounded-r-md border-l border-primary-foreground/30 bg-primary px-2 py-2 text-primary-foreground',
              'hover:bg-primary/90 disabled:opacity-50',
            )}
          >
            <ChevronDown className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-64" onCloseAutoFocus={onMenuCloseAutoFocus}>
          <DropdownMenuLabel className="text-xs text-muted-foreground">예약 보내기</DropdownMenuLabel>
          {presets.map((p) => (
            <DropdownMenuItem
              key={p.key}
              data-testid={`mail-schedule-preset-${p.key}`}
              onSelect={(e) => {
                // 잠겼으면 메뉴를 닫지 않고 안내를 보인다.
                if (!pickPreset(p)) e.preventDefault();
              }}
            >
              <PresetBody preset={p} />
            </DropdownMenuItem>
          ))}
          {blocked && <BlockedNote className="px-2 py-1" />}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid="mail-schedule-custom"
            onSelect={() => {
              pendingOpen.current = 'dialog';
            }}
          >
            <CalendarClock aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            날짜·시간 선택
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog}
    </>
  );
}
