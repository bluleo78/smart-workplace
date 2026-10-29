// 메일 작성창 받는사람·참조·숨은참조 입력(WP-945) — 넣은 수신인은 칩으로 보이고, 쓰는 중인 조각에 최근 수신인·구성원·주소록 후보를 띄운다.
// 사람 후보 아래에는 이름이 맞는 조직도 부서·내 그룹을 따로 보이고, 고르면 그때의 구성원 주소를 칩으로 풀어 넣는다(WP-1060).
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Users, X } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { fetchRecipientGroupMembers, useRecipientSuggestions } from '@/hooks/queries/useRecipientSuggestions';
import { avatarInitials } from '@/lib/avatarColor';
import { isImeComposing } from '@/lib/imeKey';
import {
  expandGroupRecipients,
  groupExpansionToast,
  RECIPIENT_GROUP_KIND_LABEL,
  type RecipientGroupSuggestion,
} from '@/lib/mailRecipientGroups';
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

/** 후보 목록의 한 줄 — 사람 후보 또는 부서·내 그룹 후보. ↑↓·Enter 는 둘을 한 목록으로 넘나든다. */
type SuggestionOption = { type: 'person'; person: RecipientSuggestion } | { type: 'group'; group: RecipientGroupSuggestion };

/** 후보 줄을 가리키는 키 — 짚은 줄을 순번이 아니라 이 키로 든다(후보가 늦게 바뀌어 순번이 다른 줄을 가리키지 않게). */
function optionKey(o: SuggestionOption): string {
  return o.type === 'person' ? `person-${o.person.address.toLowerCase()}` : `group-${o.group.id}`;
}

/** 그룹 줄의 둘째 줄 — 부서는 상위 경로(하위 부서가 있으면 그 사실), 내 그룹은 외부 연락처 수. 보일 것이 없으면 null. */
function groupSubline(g: RecipientGroupSuggestion): string | null {
  if (g.kind === 'department') {
    const full = g.path ? `${g.path} › ${g.name}` : g.name;
    return g.hasChildren ? `${full} (하위 부서 포함)` : full;
  }
  const parts = [g.path ? `${g.path} › ${g.name}` : null];
  const externals = g.count?.external ?? 0;
  if (externals > 0) parts.push(`외부 연락처 ${externals}명 포함`);
  return parts.filter(Boolean).join(' · ') || null;
}

/** 후보 목록의 묶음 제목(사람 / 조직·그룹) — 고를 수 없는 줄이라 읽기 도구에는 목록 항목으로 읽히지 않게 한다. */
function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <li role="presentation" className="px-2 pt-1.5 pb-0.5 text-[11px] text-muted-foreground">
      {children}
    </li>
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
 * 부서·내 그룹 줄은 Enter·Tab 의 기본 후보가 되지 않는다 — ↑↓ 로 그 줄까지 직접 옮겼을 때만 키로 고른다(마우스는 누르기).
 * 키 한 번에 부서 전체가 실수로 풀려 들어가지 않게 하려는 것이다. 짚은 줄은 줄의 키로 들어, 후보가 늦게 바뀌어 그 줄이 사라지면 짚지 않은
 * 상태로 돌아간다(같은 순번에 온 다른 줄 — 부서 — 이 고르지 않았는데 풀리지 않게). 인원을 세는 중인 그룹 줄이면 Enter·Tab 은 평소대로
 * 동작한다. 인원을 불러오지 못한 줄은 고르면 구성원을 새로 받아 다시 해 본다.
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
  // ↑↓·마우스로 짚은 후보 줄의 키(optionKey)와 ↑↓ 로 짚었는지(byKey) — null 이면 아직 짚지 않았다(첫 후보가 강조되고, 쓴 글자가 완성된
  // 주소면 Enter 가 그 주소를 넣는다). 마우스를 올려 짚은 그룹 줄은 Enter·Tab 으로 고르지 않는다(손을 얹어 둔 채 Enter 로 부서가 풀리지 않게).
  const [active, setActive] = useState<{ key: string; byKey: boolean } | null>(null);
  // 바깥에서 value 를 새로 넣은 횟수 — 그룹 구성원을 받는 사이 값이 통째로 바뀌었으면(답장 채우기·임시저장 다시 열기) 받은 주소를 붙이지 않는다.
  const [resets, setResets] = useState(0);
  const listId = useId();

  // 바깥에서 value 가 바뀌면(임시저장 다시 열기·답장 채우기) 렌더 중에 바로 칩으로 다시 나눈다(이펙트로 한 번 더 그리지 않게).
  if (value !== synced) {
    setSynced(value);
    setChips(toChips(value));
    setText('');
    setResets((n) => n + 1);
  }

  const exclude = useMemo(() => new Set(chips.map((c) => c.key)), [chips]);
  const { query, items, groups } = useRecipientSuggestions(focused ? text : '', exclude, focused);
  // 사람 후보 뒤에 부서·내 그룹 후보 — 키보드·마우스 순번은 이 한 목록 기준이다.
  const options = useMemo<SuggestionOption[]>(
    () => [
      ...items.map((person) => ({ type: 'person' as const, person })),
      ...groups.map((group) => ({ type: 'group' as const, group })),
    ],
    [items, groups],
  );
  const open = focused && !dismissed && text.trim().length > 0 && options.length > 0;
  // 짚은 줄의 지금 순번 — 그 줄이 목록에서 사라졌으면 짚지 않은 것으로 본다(pointed 가 null).
  const pointedIndex = active !== null ? options.findIndex((o) => optionKey(o) === active.key) : -1;
  const pointed = pointedIndex >= 0 ? active : null;
  // 강조된 후보 순번. 짚지 않았으면 첫 사람 후보 — 첫 줄이 그룹이면(사람 후보가 없으면) 아무 줄도 강조하지 않는다(-1).
  const activeIndex = pointed !== null ? pointedIndex : options[0]?.type === 'person' ? 0 : -1;
  // 후보가 지금 쓴 글자를 기준으로 찾은 것인지 — 아니면 Enter·Tab 으로 고르지 않는다.
  const fresh = query === text.trim();

  const queryClient = useQueryClient();
  // 지금의 칩·글자·한 줄 — 그룹 구성원을 받은 뒤 그때의 칸에 더한다(받는 사이 사용자가 친 글자·지운 칩을 덮지 않게).
  const latest = useRef({ chips, text, synced, onChange, resets });
  useEffect(() => {
    latest.current = { chips, text, synced, onChange, resets };
  });
  // 칸이 아직 화면에 있는지 — 구성원을 받는 사이 작성창이 닫혔으면 받은 주소를 넣거나 알리지 않는다.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // 같은 그룹을 받는 중에 또 고르면(두 번 누르기) 한 번만 넣는다.
  const expanding = useRef<Set<number>>(new Set());

  const emit = (nextChips: RecipientChip[], nextText: string) => {
    setChips(nextChips);
    setText(nextText);
    const joined = joinRecipients(nextChips, nextText);
    const cur = latest.current;
    // 다음 렌더 전에 다른 그룹 풀기가 끝나도 이번 칩 위에 더하도록 바로 고쳐 둔다.
    latest.current = { ...cur, chips: nextChips, text: nextText, synced: joined };
    if (joined === cur.synced) return;
    setSynced(joined);
    cur.onChange(joined);
  };

  /** 쓰는 중인 조각을 칩으로 굳힌다. 굳힐 것이 없으면 false. */
  const commitText = () => {
    if (!text.trim()) return false;
    emit([...chips, ...toChips(text)], '');
    return true;
  };

  /**
   * 후보를 고른다. 사람은 칩 하나, 부서·내 그룹은 고르는 지금의 구성원 주소를 칩으로 풀어 넣는다(WP-1060) — 이 칸에 이미 있는 주소는 빼고,
   * 주소가 없는 사람은 넣지 않고, 결과를 토스트로 알린다. 인원을 세는 중인 그룹 줄은 고르지 않는다 — 불러오지 못한 줄은 고르면 새로 받아 다시 해 본다.
   */
  const pick = (o: SuggestionOption) => {
    setActive(null);
    if (o.type === 'person') {
      emit([...chips, toChip(o.person)], '');
      return;
    }
    const { group } = o;
    if (!group.count && !group.failed) return;
    // 찾던 조각은 바로 비운다(후보가 닫힌다). 구성원은 줄의 인원 수용 캐시가 아니라 지금 서버에서 새로 받아 푼다.
    emit(chips, '');
    void expandGroup(group);
  };

  /** 그룹의 지금 구성원을 새로 받아 그때의 칸에 칩으로 더하고 결과를 알린다. 받지 못하면 아무것도 넣지 않고 오류를 알린다. */
  const expandGroup = async (group: RecipientGroupSuggestion) => {
    if (expanding.current.has(group.id)) return;
    expanding.current.add(group.id);
    const startedAt = latest.current.resets;
    try {
      const members = await fetchRecipientGroupMembers(queryClient, group.id);
      // 받는 사이 작성창이 닫혔거나 바깥에서 값을 통째로 바꿨으면(답장 채우기 등) 옛 그룹 주소를 새 값에 붙이지 않는다.
      if (!mounted.current || latest.current.resets !== startedAt) return;
      const { chips: curChips, text: curText } = latest.current;
      const result = expandGroupRecipients(members, new Set(curChips.map((c) => c.key)));
      if (result.chips.length > 0) emit([...curChips, ...result.chips], curText);
      const message = groupExpansionToast(group.name, result);
      if (result.chips.length > 0) toast.success(message);
      else toast.info(message);
    } catch {
      if (!mounted.current) return;
      toast.error(`${group.name} 구성원을 불러오지 못해 아무 주소도 넣지 않았습니다. 잠시 후 다시 골라 주세요.`);
    } finally {
      expanding.current.delete(group.id);
    }
  };

  /**
   * Enter·Tab 으로 넣을 후보 — 없으면(null) 쓴 글자를 그대로 굳힌다(Tab 은 다음 칸으로).
   * 그룹 줄은 ↑↓ 로 직접 옮겨 짚었고 인원을 세는 중이 아닌 때만 — 기본 후보로는 사람만 고른다.
   */
  const keyboardPick = (): SuggestionOption | null => {
    if (!open || !fresh || activeIndex < 0) return null;
    if (pointed === null && isCompleteAddress(text)) return null;
    const o = options[activeIndex];
    if (o.type === 'person') return o;
    return pointed?.byKey && (o.group.count || o.group.failed) ? o : null;
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
          aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
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
              // 아무 줄도 강조되지 않았으면(-1) ↓ 는 첫 줄, ↑ 는 마지막 줄로.
              const from = activeIndex < 0 ? (step > 0 ? -1 : 0) : activeIndex;
              setActive({ key: optionKey(options[(from + step + options.length) % options.length]), byKey: true });
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
          {groups.length > 0 && items.length > 0 && <SectionHeading>사람</SectionHeading>}
          {items.map((s, i) => (
            <li
              key={s.address}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              data-testid="mail-recipient-suggestion"
              // 누르는 순간 입력 칸이 초점을 잃으면 조각이 먼저 칩으로 굳으므로 초점을 지킨다.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive({ key: optionKey({ type: 'person', person: s }), byKey: false })}
              onClick={() => pick({ type: 'person', person: s })}
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
          {groups.length > 0 && <SectionHeading>조직·그룹 — 고르면 구성원 주소로 풀어 넣습니다</SectionHeading>}
          {groups.map((g, gi) => {
            const i = items.length + gi;
            // 인원을 세는 중인 줄만 고를 수 없다 — 불러오지 못한 줄은 고르면 다시 받는다.
            const ready = !!g.count || g.failed;
            const count = g.count ? `${g.count.total}명` : g.failed ? '인원을 불러오지 못했습니다' : '인원 세는 중';
            const sub = groupSubline(g);
            const Icon = g.kind === 'department' ? Building2 : Users;
            return (
              <li
                key={`group-${g.id}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                aria-disabled={ready ? undefined : true}
                data-testid="mail-recipient-group-suggestion"
                data-kind={g.kind}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive({ key: `group-${g.id}`, byKey: false })}
                onClick={() => pick({ type: 'group', group: g })}
                className={cn(
                  'flex items-center gap-2.5 rounded px-2 py-1.5 text-sm pointer-coarse:min-h-11',
                  ready ? 'cursor-pointer' : 'cursor-default text-muted-foreground',
                  i === activeIndex && 'bg-accent',
                )}
              >
                {/* 네모 아바타 — 사람(동그라미)과 갈라 보이게. */}
                <span
                  aria-hidden
                  className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    <Highlighted text={g.name} query={query} />
                    <span data-testid="mail-recipient-group-count" className="font-normal text-muted-foreground">
                      {' · '}
                      {count}
                    </span>
                  </span>
                  {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
                </span>
                <span className="shrink-0 rounded border px-1.5 text-[11px] text-muted-foreground">
                  {RECIPIENT_GROUP_KIND_LABEL[g.kind]}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
