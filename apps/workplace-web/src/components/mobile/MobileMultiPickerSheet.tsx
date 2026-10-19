// 모바일 다중 선택 바텀시트(WP-196) — 담당자처럼 여러 개를 고르는 값. 행을 탭해 토글하고, 시트가 닫힐 때(완료·바깥 탭·아래로 끌기)
// 한 번만 onClose(최종 선택)으로 알린다 — 데스크톱 AssigneePickerPopover 의 "닫을 때 집합 교체" 의미와 같다.
// WP-394: onCreate 를 주면 검색어와 이름이 정확히 같은 항목이 없을 때 「만들기」 행을 보이고, 만든 항목을 바로 선택한다.
import { Check, Plus } from 'lucide-react';
import { useState } from 'react';

import { cn, eulReul } from '@/lib/utils';

import type { PickerOption } from './MobilePickerSheet';
import { MOBILE_SHEET_ROW, MobileSheetShell } from './MobileSheetShell';

export function MobileMultiPickerSheet({
  open, onClose, title, options, value, searchable = false, testId = 'mobile-multi-picker-sheet', onCreate, countUnit = '개',
}: {
  open: boolean;
  onClose: (selected: string[]) => void;
  title: string;
  options: PickerOption[];
  value: string[];
  searchable?: boolean;
  testId?: string;
  /** 검색어로 새 항목을 만들고 그 value 를 돌려준다(실패하면 reject — 오류 표시는 호출부 몫). searchable 일 때만 쓰인다. */
  onCreate?: (name: string) => Promise<string>;
  /** 안내 문구의 세는 단위 — 사람(담당자)은 「명」, 그 밖(라벨 등)은 「개」(WP-499). */
  countUnit?: '명' | '개';
}) {
  const [picked, setPicked] = useState<string[]>(value);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  // 열릴 때마다 현재 값으로 다시 시작 — 지난번 열었다가 닫은 선택이 남지 않게. effect 대신 렌더 중 상태 조정
  // (React 권장 패턴, eslint-disable 불필요). 열린 동안 value 가 바뀌어도 사용자의 편집 중 선택은 덮지 않는다.
  // key 리마운트는 닫힘 애니메이션 중 체크가 초기화돼 깜빡이므로 쓰지 않는다.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPicked(value);
      setQ('');
    }
  }
  const keyword = q.trim().toLowerCase();
  const shown = keyword ? options.filter((o) => o.label.toLowerCase().includes(keyword)) : options;
  const toggle = (v: string) => setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  // 만드는 중엔 닫지 않는다 — 새 항목이 picked 에 들기 전에 onClose 가 불리면 이슈에 안 붙는다.
  const close = () => {
    if (!creating) onClose(picked);
  };
  // 만들 이름 — 정확 일치(대소문자 구분)하는 항목이 없을 때만 만들기를 연다(라벨 유일 제약과 같은 기준).
  const newName = q.trim();
  const canCreate = searchable && !!onCreate && newName.length > 0 && !options.some((o) => o.label === newName);
  const create = async () => {
    if (!onCreate || !canCreate || creating) return;
    setCreating(true);
    try {
      const v = await onCreate(newName);
      setPicked((p) => (p.includes(v) ? p : [...p, v]));
      setQ('');
    } catch {
      // 실패 안내는 onCreate 쪽(mutation onError)이 맡는다 — 시트는 검색어를 그대로 둬 다시 시도할 수 있게 한다.
    } finally {
      setCreating(false);
    }
  };

  return (
    <MobileSheetShell
      open={open}
      onClose={close}
      title={title}
      description={`${title}${eulReul(title)} 여러 ${countUnit} 고를 수 있습니다.`}
      testId={testId}
      autoFocus={searchable}
      headerAction={
        <button type="button" data-testid={`${testId}-done`} onClick={close} className="h-11 px-2 text-sm font-medium text-primary">
          완료
        </button>
      }
    >
      {searchable && (
        <div className="px-4 pb-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="검색"
            data-testid={`${testId}-search`}
            className="h-10 w-full rounded-md border bg-background px-3 text-base"
          />
        </div>
      )}
      <div role="listbox" aria-multiselectable aria-label={title} className="min-h-0 flex-1 overflow-y-auto py-1">
        {shown.map((o) => {
          const on = picked.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={on}
              data-testid={`multi-option-${o.value}`}
              onClick={() => toggle(o.value)}
              className={cn(MOBILE_SHEET_ROW, on && 'font-medium')}
            >
              {o.icon}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.hint && <span className="shrink-0 text-xs text-muted-foreground">{o.hint}</span>}
              <span className={cn('flex size-5 items-center justify-center rounded border', on && 'border-primary bg-primary text-primary-foreground')}>
                {on && <Check className="size-3.5" aria-hidden />}
              </span>
            </button>
          );
        })}
        {shown.length === 0 && !canCreate && <p className="px-4 py-6 text-center text-sm text-muted-foreground">결과가 없습니다</p>}
        {canCreate && (
          <button
            type="button"
            data-testid={`${testId}-create`}
            onClick={create}
            disabled={creating}
            className={cn(MOBILE_SHEET_ROW, 'border-t disabled:opacity-60')}
          >
            <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">「{newName}」</span> {title} 만들기
            </span>
          </button>
        )}
      </div>
    </MobileSheetShell>
  );
}
