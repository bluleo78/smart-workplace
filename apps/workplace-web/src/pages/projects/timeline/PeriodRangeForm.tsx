// 조회 기간 「직접 지정」 폼(WP-247) — 시작일·종료일 두 칸 + 적용. 데스크톱 팝오버·모바일 시트 공용.
// 시작 > 종료이거나 비어 있으면 적용할 수 없다(뒤집힌 기간을 조용히 바로잡지 않고 사용자에게 고치게 한다).
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function PeriodRangeForm({
  initial, onApply, inputClassName, buttonClassName,
}: {
  initial: { from: string; to: string } | null;
  onApply: (from: string, to: string) => void;
  /** 날짜 칸·적용 버튼 추가 클래스 — 모바일 시트는 터치 영역 44px(h-11)·16px 글자로 키운다. */
  inputClassName?: string;
  buttonClassName?: string;
}) {
  const [from, setFrom] = useState(initial?.from ?? '');
  const [to, setTo] = useState(initial?.to ?? '');
  const valid = from !== '' && to !== '' && from <= to;
  // 둘 다 채웠는데 뒤집혔을 때만 이유를 보인다(비어 있을 때는 비활성 버튼으로 충분).
  const reversed = from !== '' && to !== '' && from > to;
  const input = cn('h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm', inputClassName);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onApply(from, to);
      }}
    >
      <div className="flex items-center gap-1.5">
        <input type="date" aria-label="시작일" data-testid="period-range-from" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
        <span className="text-muted-foreground" aria-hidden="true">–</span>
        <input type="date" aria-label="종료일" data-testid="period-range-to" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
      </div>
      {reversed && (
        <p data-testid="period-range-error" className="text-xs text-destructive">
          시작일이 종료일보다 늦어요
        </p>
      )}
      <Button type="submit" size="sm" disabled={!valid} data-testid="period-range-apply" className={buttonClassName}>
        적용
      </Button>
    </form>
  );
}
