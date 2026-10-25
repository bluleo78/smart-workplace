// 메일 작성창 받는사람·참조·숨은참조 입력(WP-945) — 넣은 수신인은 칩으로 보이고, 쓰는 중인 조각에 최근 수신인·구성원·주소록 후보를 띄운다.
import { X } from 'lucide-react';
import { type ReactNode, type RefObject, useId, useMemo, useRef, useState } from 'react';

import { useRecipientSuggestions } from '@/hooks/queries/useRecipientSuggestions';
import { avatarInitials } from '@/lib/avatarColor';
import { isImeComposing } from '@/lib/imeKey';
import {
  isCompleteAddress,
  joinRecipients,
  RECIPIENT_SOURCE_LABEL,
  type RecipientChip,
  type RecipientSuggestion,
  splitTypedRecipients,
  toChip,
  toChips,
} from '@/lib/mailRecipientSuggest';
import { cn } from '@/lib/utils';

/** 후보 글자에서 찾은 부분을 굵게 — 대소문자 무시, 처음 한 곳만. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <b className="font-semibold text-primary">{text.slice(at, at + query.length)}</b>
      {text.slice(at + query.length)}
    </>
  );
}

/**
 * 수신인 칩 입력. 바깥 상태는 지금처럼 쉼표로 이은 한 줄(value)이다 — 임시저장·답장 채우기·발송이 그 한 줄을 그대로 쓴다.
 * 안에서는 칩(굳힌 주소)과 쓰는 중인 조각으로 나눠 들고, 바뀔 때마다 둘을 다시 이어 onChange 로 넘긴다.
 * 바깥에서 value 가 바뀌면(임시저장 다시 열기·답장) 전부 칩으로 다시 나눈다.
 *
 * 굳히는 때: 쉼표·세미콜론 입력(붙여 넣기 포함), Enter·Tab, 칸을 떠날 때, 후보 고르기. 빈 칸에서 Backspace 는 마지막 칩을 칸으로 되돌려
 * 고쳐 쓰게 한다(잘못 친 주소를 다시 칠 필요가 없게).
 *
 * Enter·Tab 은 쓴 글자가 완성된 주소면 그 주소를, 아니면 강조된 후보를 넣는다. ↑↓·마우스로 후보를 짚었으면 그 후보다. 후보가 아직 지금
 * 글자를 따라오지 못했으면(디바운스·응답 대기) 후보를 고르지 않는다 — 다른 사람이 들어가지 않게.
 */
export function MailRecipientInput({
  label,
  mobile,
  testId,
  value,
  onChange,
  inputRef,
  trailing,
}: {
  label: string;
  mobile: boolean;
  testId: string;
  value: string;
  onChange: (v: string) => void;
  /** 바깥에서 초점을 줄 때 쓰는 ref(작성창을 열면 받는사람에 초점). 없으면 안에서 만든다. */
  inputRef?: RefObject<HTMLInputElement | null>;
  trailing?: ReactNode;
}) {
  const [chips, setChips] = useState<RecipientChip[]>(() => toChips(value));
  const [text, setText] = useState('');
  // 마지막으로 바깥에 넘긴(또는 받은) 한 줄 — 들어온 value 가 이것과 같으면 내가 바꾼 것이라 다시 나누지 않는다(쓰는 중인 조각을 지키려고).
  const [synced, setSynced] = useState(value);
  const fallbackRef = useRef<HTMLInputElement | null>(null);
  const ownInputRef = inputRef ?? fallbackRef;
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // ↑↓·마우스로 짚은 후보 순번 — null 이면 아직 짚지 않았다(첫 후보가 강조되고, 쓴 글자가 완성된 주소면 Enter 가 그 주소를 넣는다).
  const [active, setActive] = useState<number | null>(null);
  const listId = useId();

  // 바깥에서 value 가 바뀌면(임시저장 다시 열기·답장 채우기) 렌더 중에 바로 칩으로 다시 나눈다(이펙트로 한 번 더 그리지 않게).
  if (value !== synced) {
    setSynced(value);
    setChips(toChips(value));
    setText('');
  }

  const exclude = useMemo(() => new Set(chips.map((c) => c.key)), [chips]);
  const { query, items } = useRecipientSuggestions(focused ? text : '', exclude, focused);
  const open = focused && !dismissed && text.trim().length > 0 && items.length > 0;
  const activeIndex = Math.min(active ?? 0, Math.max(0, items.length - 1));
  // 후보가 지금 쓴 글자를 기준으로 찾은 것인지 — 아니면 Enter·Tab 으로 고르지 않는다.
  const fresh = query === text.trim();

  const emit = (nextChips: RecipientChip[], nextText: string) => {
    setChips(nextChips);
    setText(nextText);
    const joined = joinRecipients(nextChips, nextText);
    if (joined === synced) return;
    setSynced(joined);
    onChange(joined);
  };

  /** 쓰는 중인 조각을 칩으로 굳힌다. 굳힐 것이 없으면 false. */
  const commitText = () => {
    if (!text.trim()) return false;
    emit([...chips, ...toChips(text)], '');
    return true;
  };

  const pick = (s: RecipientSuggestion) => {
    emit([...chips, toChip(s)], '');
    setActive(null);
  };

  /** Enter·Tab 으로 넣을 후보 — 없으면 쓴 글자를 그대로 굳힌다. */
  const keyboardPick = (): RecipientSuggestion | null => {
    if (!open || !fresh) return null;
    if (active === null && isCompleteAddress(text)) return null;
    return items[activeIndex];
  };

  const removeAt = (index: number) => {
    emit(
      chips.filter((_, i) => i !== index),
      text,
    );
    ownInputRef.current?.focus();
  };

  return (
    <div className={cn('relative flex items-center gap-2 border-b focus-within:border-primary', mobile ? 'py-3' : 'pb-2')}>
      {mobile && (
        <label htmlFor={testId} className="w-16 shrink-0 text-sm text-muted-foreground">
          {label}
        </label>
      )}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {chips.map((chip, i) => {
          const { ok } = chip;
          return (
            <span
              // 같은 주소를 두 번 넣을 수도 있어 순서를 함께 키로 쓴다.
              key={`${i}-${chip.label}`}
              data-testid={`${testId}-chip`}
              data-value={chip.label}
              data-invalid={ok ? undefined : 'true'}
              title={ok ? chip.label : `${chip.label} — 메일 주소 형식이 아닙니다`}
              className={cn(
                'inline-flex max-w-full items-center gap-0.5 rounded-full py-0.5 pr-0.5 pl-2',
                mobile ? 'text-sm' : 'text-xs',
                ok ? 'bg-info-subtle text-foreground' : 'bg-destructive-subtle text-destructive-text',
              )}
            >
              <span className="truncate">{chip.text}</span>
              <button
                type="button"
                aria-label={`${chip.text} 빼기`}
                data-testid={`${testId}-chip-remove`}
                onClick={() => removeAt(i)}
                className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground pointer-coarse:p-1.5"
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          );
        })}
        <input
          ref={ownInputRef}
          id={testId}
          data-testid={testId}
          value={text}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
          autoComplete="off"
          onChange={(e) => {
            const { committed, rest } = splitTypedRecipients(e.target.value);
            emit(committed.length > 0 ? [...chips, ...committed] : chips, rest);
            setDismissed(false);
            setActive(null);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commitText();
          }}
          onKeyDown={(e) => {
            if (isImeComposing(e.nativeEvent)) return;
            if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault();
              const step = e.key === 'ArrowDown' ? 1 : -1;
              setActive((activeIndex + step + items.length) % items.length);
            } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey && text.trim())) {
              const chosen = keyboardPick();
              if (chosen) {
                e.preventDefault();
                pick(chosen);
              } else if (commitText() && e.key === 'Enter') {
                e.preventDefault();
              }
            } else if (e.key === 'Escape' && open) {
              // 후보만 닫는다 — 크게 보기 창의 Esc(작은 창으로)까지 가지 않게 막는다.
              e.preventDefault();
              e.stopPropagation();
              setDismissed(true);
            } else if (e.key === 'Backspace' && text === '' && chips.length > 0) {
              // 마지막 칩을 칸으로 되돌려 고쳐 쓰게 한다 — 한 번 더 지우면 글자가 지워진다.
              e.preventDefault();
              emit(chips.slice(0, -1), chips[chips.length - 1].label);
              setDismissed(true);
            }
          }}
          placeholder={mobile || chips.length > 0 ? undefined : label}
          className={cn('min-w-24 flex-1 bg-transparent outline-none', mobile ? 'text-[15px]' : 'text-sm')}
        />
      </div>
      {trailing}
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} 후보`}
          data-testid={`${testId}-suggestions`}
          className="absolute top-full left-0 z-50 mt-1 w-full max-w-sm rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {items.map((s, i) => (
            <li
              key={s.address}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              data-testid="mail-recipient-suggestion"
              // 누르는 순간 입력 칸이 초점을 잃으면 조각이 먼저 칩으로 굳으므로 초점을 지킨다.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s)}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm pointer-coarse:min-h-11',
                i === activeIndex && 'bg-accent',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                  s.source === 'external' ? 'bg-muted text-muted-foreground' : 'bg-info-subtle text-foreground',
                )}
              >
                {avatarInitials(s.name ?? s.address)}
              </span>
              <span className="min-w-0 flex-1">
                {s.name && (
                  <span className="block truncate font-medium">
                    <Highlighted text={s.name} query={query} />
                  </span>
                )}
                <span className={cn('block truncate', s.name ? 'text-xs text-muted-foreground' : 'font-medium')}>
                  <Highlighted text={s.address} query={query} />
                </span>
              </span>
              <span className="shrink-0 rounded border px-1.5 text-[11px] text-muted-foreground">
                {RECIPIENT_SOURCE_LABEL[s.source]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
