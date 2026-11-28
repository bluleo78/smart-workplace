// 메일 작성창 받는사람·참조·숨은참조 입력(WP-945) — 넣은 수신인은 칩으로 보이고, 쓰는 중인 조각에 최근 수신인·구성원·주소록 후보를 띄운다.
// 사람 후보 아래에는 이름이 맞는 조직도 부서·내 그룹을 따로 보이고, 고르면 그때의 구성원 주소를 칩으로 풀어 넣는다(WP-1060).
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Users, X } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/overlay/dropdown-menu';
import { fetchRecipientGroupMembers, useRecipientSuggestions } from '@/hooks/queries/useRecipientSuggestions';
import { avatarInitials } from '@/lib/avatarColor';
import { DROP_TARGET_CLASS } from '@/lib/dndDropClass';
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
  RECIPIENT_FIELD_LABEL,
  RECIPIENT_SOURCE_LABEL,
  type RecipientChip,
  type RecipientField,
  recipientFieldMoveLabel,
  type RecipientSuggestion,
  splitField,
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
 * 부모(MailComposeDock) 가 넘기는 끌기 연결(WP-2150) — 끌기 가능 여부·지금 드래그 중인지·끌기가 끝난 시각.
 * 리스너·속성을 밖으로 넘기지 않으므로 useDraggable 은 칩을 그리는 컴포넌트 안에서만 부른다(훅 규칙 유지).
 */
type RecipientDnd = {
  /** 끌기를 껐는지(모바일) — true 면 칩을 끌 수 없다(센서도 꺼져 스크롤을 방해하지 않는다). */
  dragDisabled: boolean;
  /** 지금 드래그가 진행 중인가 — 각 칸에 점선·칸 이름 라벨을 그린다. */
  dragging: boolean;
  /** 끌기가 끝난 시각 — 끌기 직후의 click 은 메뉴를 열지 않게 하는 데 쓴다(0 이면 아직 없음). */
  lastDragEndedAt: () => number;
};

/**
 * 손으로 탭했는지 판정하는 허용 오차(px) — 누른 자리에서 이만큼 안에서 손을 떼면 탭으로 본다.
 * 그보다 멀리서 떼면 끌기·화면 이동이라 메뉴를 열지 않는다.
 */
const TAP_SLOP_PX = 10;

/**
 * 끌기로 끝난 뒤에도 메뉴를 막는 시간(ms) — 끌기와 메뉴가 같은 단추라 끌고 나면 메뉴가 뜨지 않아야 한다.
 * 손을 뗀 pointerup 부터 dnd-kit 의 문서 리스너(DragEnd)·click 이 다 올 때까지의 간격을 덮도록 여유를 둔다.
 */
const DRAG_CLICK_GUARD_MS = 300;

/**
 * 수신인 칩 하나 — 이름 단추는 「다른 두 칸으로 옮기기·주소 복사·빼기」 메뉴이자 끌기 활성화 노드다(WP-2150).
 * useDraggable 은 여기서만 부른다 — 바깥(MailRecipientInput)은 dnd 값과 콜백만 넘기고 리스너를 빼내지 않는다.
 * 끌기가 꺼져 있으면 dnd-kit 속성·리스너를 붙이지 않아 평범한 이름 단추로 남는다(dnd 없는 호출).
 */
function RecipientChipButton({
  chip,
  index,
  field,
  testId,
  mobile,
  menuOpen,
  dragEnabled,
  dnd,
  onMenuOpenChange,
  onMove,
  onRemove,
  onCopy,
}: {
  chip: RecipientChip;
  index: number;
  field: RecipientField;
  testId: string;
  mobile: boolean;
  /** 지금 이 칩의 메뉴가 열려 있는가 — 열려 있는 동안엔 끌지 않는다(끄는 것은 아래 누름 판정이 맡는다). */
  menuOpen: boolean;
  /** 끌 수 있는가 — dnd 값과 열려 있는 메뉴를 바깥이 합쳐서 준다. */
  dragEnabled: boolean;
  dnd?: RecipientDnd;
  onMenuOpenChange: (open: boolean) => void;
  onMove?: (index: number, target: RecipientField) => void;
  onRemove: (index: number) => void;
  onCopy: (label: string) => void;
}) {
  const { ok } = chip;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    // 칸 이름:순번 — 세 칸의 칩이 한 DndContext 안에서 모두 유일하다. 표시 이름(text)은 낭독이
    // 「무슨 칩」을 잡았는지 한국어로 읽도록 함께 실어 보낸다(MailComposeDock announcements 가 쓴다).
    id: `${field}:${index}`,
    data: { field, index, text: chip.text },
    // 메뉴가 열려 있으면 끌기 활성화를 막는다 — disabled 면 리스너도 nil 이라 누르면 끌리지 않는다.
    disabled: !dragEnabled,
    attributes: { roleDescription: '옮길 수 있는 수신인' },
  });
  // dnd 가 없거나 끌기가 꺼져 있으면(모바일) 끌기 속성도 붙이지 않는다 — 쓰지 못하는 끌기를 스크린리더에 알리지 않기 위해서.
  // 메뉴가 열려 있을 때(dragDisabled 는 false)만 aria-disabled 로 "지금은 끌 수 없다" 를 알린다 — 그 밖의 끌기는 그대로 쓴다.
  const dragProps = dnd && !dnd.dragDisabled ? { ...attributes, ...listeners } : {};
  // 손으로 누른 순간의 메뉴 상태 — 열려 있는 메뉴를 누르면 닫고, 아니면 연다(누르는 사이 메뉴가 닫혀도 판정이 흔들리지 않게).
  const pressRef = useRef(false);
  // 누른 자리 — pointerup 에서 "그 자리에서 손을 뗐는지(탭인지)"를 판정하는 데 쓴다(누르지 않고 뗀 포인터는 무시).
  const pressPointRef = useRef<{ id: number; x: number; y: number } | null>(null);
  /**
   * 끌기로 끝난 직후인지 — 그 직후의 누름은 메뉴를 열지 않는다. 아래 pointerup·click 두 판정이 같은 시간 창을 써야
   * 서로 다른 틱에서 다른 결론이 나지 않는다(메뉴가 끌기와 겹쳐 열리거나 남는 흔들림을 막는다).
   */
  const justDragged = () => {
    const endedAt = dnd?.lastDragEndedAt() ?? 0;
    return endedAt > 0 && performance.now() - endedAt < DRAG_CLICK_GUARD_MS;
  };

  return (
    <span
      // 끌리는 칩의 자리 측정 노드 — 오버레이 고스트가 이 자리에서 시작한다.
      ref={setNodeRef}
      data-testid={`${testId}-chip`}
      data-value={chip.label}
      data-invalid={ok ? undefined : 'true'}
      title={ok ? chip.label : `${chip.label} — 메일 주소 형식이 아닙니다`}
      className={cn(
        'inline-flex max-w-full items-center gap-0.5 rounded-full py-0.5 pr-0.5 pl-2',
        mobile ? 'text-sm' : 'text-xs',
        ok ? 'bg-info-subtle text-foreground' : 'bg-destructive-subtle text-destructive-text',
        // 끌리는 칩은 원래 자리에 남되 흐리게 — 고스트가 따라오는 동안 빈 자리임이 보인다.
        isDragging && 'opacity-40',
      )}
    >
      <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            // 끌기 활성화 노드 — 포인터를 이 단추에서만 끌기 시작한다.
            ref={setActivatorNodeRef}
            data-testid={`${testId}-chip-menu`}
            aria-label={`${chip.text} 메뉴`}
            draggable={false}
            className="max-w-full truncate text-left select-none"
            {...dragProps}
            onPointerDown={
              !dnd
                ? // 끌기 연결이 없는 호출(메뉴만 쓰는 자리)은 Radix 기본에 그대로 맡긴다.
                  undefined
                : (e) => {
                    // Radix 와 같은 가드 — 오른쪽 단추·Ctrl 누름은 메뉴를 열지 않는다.
                    if (e.button !== 0 || e.ctrlKey) return;
                    pressRef.current = menuOpen;
                    pressPointRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
                    // 끌기 판정을 먼저 맡긴다 — dnd-kit 은 defaultPrevented 를 이미 받은 뒤 보므로 순서가 중요하다.
                    listeners?.onPointerDown?.(e);
                    // 누르는 순간 Radix 가 메뉴를 여는 것과 끌기가 겹치지 않게 막는다 — 열리는 아래 pointerup·click 이 맡는다.
                    // 마우스뿐 아니라 터치·펜도 같은 가드다 — 누르는 순간 열린 모달 메뉴(RemoveScroll)가 손으로 끌는
                    // 스크롤을 막기 때문이다(완료 기준 7, 디자인 5.3 「마우스·터치 둘 다 preventDefault」).
                    e.preventDefault();
                  }
            }
            onPointerUp={
              !dnd
                ? undefined
                : (e) => {
                    // 터치는 누르는 사이 화면이 스크롤되면 브라우저가 click 을 주지 않는다 — 그때도 메뉴가 뜨도록
                    // 손을 뗀 순간 판정한다(디자인 5.3 「열기는 click」의 보완 — 두 자리가 같은 결론이라 겹쳐도 흔들리지 않는다).
                    if (e.button !== 0 || e.ctrlKey) return;
                    // 누른 자리를 한 번만 쓴다 — 같은 단추를 누르지 않은 포인터가 떼어도 판정하지 않는다.
                    const start = pressPointRef.current;
                    pressPointRef.current = null;
                    if (!start || start.id !== e.pointerId) return;
                    // 누른 자리에서 멀리 떼면 탭이 아니라 끌기·화면 이동이다.
                    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP_PX) return;
                    // 끌기 중에 손을 뗀 순간 — dnd-kit 의 DragEnd 는 문서 리스너라 우리보다 뒤에 온다(메뉴를 열지 않는다).
                    if (dnd.dragging) return;
                    // 끌기로 끝난 직후 — 아래 click 이 같은 시간 창으로 판정하므로 두 판정이 같은 결론을 낸다.
                    if (justDragged()) return;
                    // 누르는 순간의 메뉴 상태만 읽는다 — 아래 click 과 같은 결론을 내리므로 겹쳐도 열기·닫기가 흔들리지 않는다.
                    onMenuOpenChange(!pressRef.current);
                  }
            }
            onClick={
              !dnd
                ? undefined
                : (e) => {
                    // 키보드(Space·Enter) 활성화는 Radix 가 keydown 에서 처리한다 — 우리 click 은 손으로 누른 것만 받는다.
                    // click 이 오지 않는 터치(누르는 사이 스크롤)는 위 pointerup 이 이미 처리했다.
                    if (e.detail === 0) return;
                    const wasOpen = pressRef.current;
                    pressRef.current = false;
                    if (wasOpen) {
                      // 열려 있던 메뉴를 누른 것 — 닫는다(누르는 순간 닫으려는 Radix 를 위에서 막았을 수 있다).
                      onMenuOpenChange(false);
                      return;
                    }
                    // 끌기로 끝난 직후의 click 을 무시한다 — 끌기와 메뉴가 같은 단추라 끌고 나면 메뉴가 뜨지 않아야 한다.
                    if (justDragged()) return;
                    onMenuOpenChange(true);
                  }
            }
          >
            {chip.text}
          </button>
        </DropdownMenuTrigger>
        {/* 메뉴는 화면 밖(portal)에 그려져 칸 안에 없다 — 어느 칸의 메뉴인지 표식을 남겨, 위 칸의 onBlur 가
            "이 칸이 연 메뉴로 초점이 옮긴 것" 을 가려낼 수 있게 한다(WP-2150 반려 ②, 앱의 다른 메뉴와 섞이지 않는다). */}
        <DropdownMenuContent align="start" data-recipient-menu={field}>
          {/* 전체 주소 — 고를 수 없는 맨 위 줄. 메뉴 항목으로 읽히지 않게 role=presentation 으로 둔다. */}
          <DropdownMenuItem disabled role="presentation">
            {chip.label}
          </DropdownMenuItem>
          {/* 자기 칸을 뺀 두 칸만 「{칸}으로 옮기기」 — 문구는 recipientFieldMoveLabel 이라 드롭 강조와 같은 글자다. */}
          {(Object.keys(RECIPIENT_FIELD_LABEL) as RecipientField[])
            .filter((f) => f !== field)
            .map((target) => (
              <DropdownMenuItem
                key={target}
                onSelect={() => {
                  // 메뉴를 닫은 뒤 옮긴다 — 두 호출은 같은 핸들러라 한 배치로 반영되고, 바깥이 칸 상태를 그때 한 번 바꾼다.
                  onMenuOpenChange(false);
                  onMove?.(index, target);
                }}
              >
                {recipientFieldMoveLabel(target)}
              </DropdownMenuItem>
            ))}
          <DropdownMenuItem
            onSelect={() => {
              onMenuOpenChange(false);
              void onCopy(chip.label);
            }}
          >
            주소 복사
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              onMenuOpenChange(false);
              onRemove(index);
            }}
          >
            빼기
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label={`${chip.text} 빼기`}
        data-testid={`${testId}-chip-remove`}
        onClick={() => onRemove(index)}
        className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground pointer-coarse:p-1.5"
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
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
 *
 * 칩 이름 단추(WP-2150)를 누르면 「다른 두 칸으로 옮기기·주소 복사·빼기」 메뉴가 열린다 — 끌어놓기와 같은 옮기기 경로(onMove·onRemove)라
 * 바깥에서 칸 상태를 맡는다. dnd 를 받으면 칩은 끌리고(dnd 값 안에서 끌기 가능 여부·드래그 중 표시를 읽는다), 칸 자신은 놓을 자리가
 * 된다(useDroppable) — 모바일(dnd.dragDisabled)에서는 메뉴만 쓴다.
 */
export function MailRecipientInput({
  label,
  mobile,
  testId,
  field,
  value,
  onChange,
  inputRef,
  trailing,
  onMove,
  onRemove,
  onRestChange,
  dnd,
  chipOpSeq,
}: {
  label: string;
  mobile: boolean;
  testId: string;
  /** 어느 칸인지 — 끌기 id 와 메뉴 「옮기기」 대상 판정에 쓴다. */
  field: RecipientField;
  value: string;
  onChange: (v: string) => void;
  /** 바깥에서 초점을 줄 때 쓰는 ref(작성창을 열면 받는사람에 초점). 없으면 안에서 만든다. */
  inputRef?: RefObject<HTMLInputElement | null>;
  trailing?: ReactNode;
  /** 칩 하나를 다른 칸으로 옮긴다(메뉴·드래그가 같은 경로) — 바깥(작성 도크)이 칩 문자열을 다시 짠다. */
  onMove?: (index: number, target: RecipientField) => void;
  /** 칩 하나를 뺀다 — 메뉴 「빼기」 와 × 단추가 같은 경로. */
  onRemove?: (index: number) => void;
  /** 지금 쓰는 중인 조각을 바깥에 알린다 — 도크가 옮기기·빼기를 칩만 다루게(WP-2150 반려). */
  onRestChange?: (field: RecipientField, rest: string) => void;
  /** 끌기 연결(WP-2150) — 없으면 칩 메뉴만 있는 그대로다. */
  dnd?: RecipientDnd;
  /**
   * 바깥이 칸 안 조작(메뉴·×·끌기)으로 칩을 빼거나 옮긴 횟수(WP-2150 2차 반려 ①) — 값이 바뀔 때 이 칸이 직접 고친 것이
   * 아니라 부모가 고친 것이면 받는 중인 부서·그룹 넣기를 끊지 않아야 해서 구분이 필요하다. **필수**다 — 옮기기·빼기를 넘기면서
   * 빠뜨리면 값이 통째로 바뀐 것으로 오해하는 결함이 조용히 되살아나므로, 칩 조작이 없는 칸이라도 0 을 명시해 준다.
   */
  chipOpSeq: number;
}) {
  const [chips, setChips] = useState<RecipientChip[]>(() => toChips(value));
  const [text, setText] = useState('');
  // 열려 있는 칩 메뉴의 순번(없으면 null) — 메뉴가 열린 동안은 끌기를 막아야 해 제어 상태로 들고 있다(바깥·드래그와 상태를 나누지 않게).
  const [menuIndex, setMenuIndex] = useState<number | null>(null);
  // 마지막으로 바깥에 넘긴(또는 받은) 한 줄 — 들어온 value 가 이것과 같으면 내가 바꾼 것이라 다시 나누지 않는다(쓰는 중인 조각을 지키려고).
  const [synced, setSynced] = useState(value);
  // 위 한 줄을 받을 때의 칩 조작 횟수 — 값이 바뀔 때 이것도 바뀌어 있으면 바깥이 칸 안 조작(메뉴·×·끌기)으로 고친 것이다.
  const [syncedOp, setSyncedOp] = useState(chipOpSeq);
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
  // 칸 전체가 놓을 자리(useDroppable) — 칩만이 아니라 칸 아무 데나 놓아도 그 칸으로 옮겨진다(설계 5.2).
  const { setNodeRef: setFieldRef, isOver } = useDroppable({ id: field, data: { field } });
  // 지금 칩을 끌 수 있는가 — 끌기 연결이 있고(모바일 아님) 칩 메뉴가 열려 있지 않을 때만(열려 있는 동안은 메뉴가 우선).
  const dragEnabled = dnd != null && !dnd.dragDisabled && menuIndex === null;

  // 바깥에서 value 가 바뀌면(임시저장 다시 열기·답장 채우기·부모의 칩 옮기기·빼기) 렌더 중에 바로 칩으로 다시 나눈다(이펙트로 한 번 더 그리지 않게).
  if (value !== synced) {
    // 값이 바뀐 까닭이 칸 안 조작(메뉴·×·끌기)이면 resets 를 세지 않는다 — 세면 그 사이에 고르던 부서·그룹 넣기가
    // "바깥이 값을 통째로 바꿨다" 로 오해해 토스트 없이 조용히 그만든다(WP-2150 2차 반려 ①).
    const fromChipOp = chipOpSeq !== syncedOp;
    setSynced(value);
    if (fromChipOp) {
      // 옮기기·빼기는 지금 쓰는 조각을 함께 남기므로 그 조각만 조각으로 친다(WP-2150 반려 ① — 조각까지 칩으로 만들면
      // 빨간 칩이 되어 입력이 비기 때문이다).
      const { chips: nextChips, rest: nextText } = splitField(value, text);
      setChips(nextChips);
      setText(nextText);
    } else {
      // 바깥이 값을 통째로 바꾼 것이다 — 예전처럼 한 줄 전체를 칩으로 나누고 쓰던 조각은 비운다.
      setChips(toChips(value));
      setText('');
      setResets((n) => n + 1);
    }
    // 칩이 다시 짝지어지면 순번이 바뀔 수 있어 열려 있던 메뉴를 닫는다 — 남의 칩에 메뉴가 열리지 않게.
    setMenuIndex(null);
  }
  // 칸 안 조작이 값까지 바꾸지 않았어도(대상 칸에 같은 주소가 있어 값이 그대로 등) 조작 횟수를 따라잡는다 —
  // 남겨 두면 다음 바깥 값 교체가 그 옛 조작의 일부로 보여 resets 가 세지지 않는다.
  if (syncedOp !== chipOpSeq) setSyncedOp(chipOpSeq);

  // 지금 쓰는 조각을 바깥(작성 도크)에 알려, 옮기기·빼기가 칩만 다루게 한다(WP-2150 반려).
  // 이펙트로 넘겨 렌더 중 부모를 건드리지 않고, 값이 리렌더를 걸지 않으므로 글자를 친 직후에 조작해도 어제 값이 아니다.
  const onRestRef = useRef(onRestChange);
  useEffect(() => {
    onRestRef.current = onRestChange;
  });
  useEffect(() => {
    onRestRef.current?.(field, text);
  });
  // 칸이 사라지면(회차가 바뀌거나 참조를 접으면) 그 칸의 조각도 비운다 — 지난 회차에 친 글자가 새 회차의 조작에 섞이지 않게.
  useEffect(() => () => onRestRef.current?.(field, ''), [field]);

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
  // 끌기 중에는 후보만 닫는다 — 짚 강조가 뜬 z-50 팝업이 놓을 칸 표시(칸 이름 라벨·강조 테두리)를 덮어, 사용자가 어느 칸에
  // 놓는지 눈으로 확인하지 못한다(완료 기준 3). blur 로 닫으면 조각이 굳어 반려 ①이 되살아나므로 blur 는 쓰지 않는다.
  const open = focused && !dismissed && !dnd?.dragging && text.trim().length > 0 && options.length > 0;
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

  /** 칩 하나를 뺀다 — 메뉴 「빼기」 와 × 단추가 같은 경로(바깥에서 맡으면 그쪽을, 아니면 지금처럼 안에서 뺀다). */
  const removeChip = (index: number) => {
    if (onRemove) {
      onRemove(index);
      // 바깥이 뺀 뒤에도 안에서 뺄 때처럼 초점이 입력 칸에 남는다 — 뺀 칩의 × 단추가 사라지면 초점이 body 로 흩어져
      // 키보드로 계속 쓰려면 Tab 을 다시 돌아와야 하기 때문이다(× 동작 변경 없음).
      // 메뉴(「빼기」)로 닫힌 뒤에는 Radix 가 트리거 칩 단추로 초점을 되돌리니, 그 뒤에 한 프레임 늦춰 다시 넣는다
      // (닫힘 이펙트가 먼저 돈다 — overlay/useMenuFocusReturn 과 같은 방식).
      requestAnimationFrame(() => ownInputRef.current?.focus());
    } else removeAt(index);
  };

  /** 칩을 다른 칸으로 옮긴다 — 메뉴 「<칸>으로/로 옮기기」. 뺀 칩과 같이 초점이 원래 칸 입력에 남게 한다(WP-2150 리뷰). */
  const moveChip = (index: number, target: RecipientField) => {
    if (!onMove) return;
    onMove(index, target);
    // 옮긴 칩은 그 자리에서 없어져, 메뉴를 닫는 Radix 가 되돌릴 트리거가 없다 — 초점이 body 로 떨어진다(빼기는 칩이 남아
    // 트리거로 돌아오지만 이동은 그렇지 않다). 위 removeChip 과 같은 방법으로 한 프레임 뒤 원래 칸 입력에 다시 넣는다.
    requestAnimationFrame(() => ownInputRef.current?.focus());
  };

  /** 주소 복사 — 클립보드가 없거나 거절되면 조용히 오류 토스트만 띄우고 그대로 진행한다(작업을 멈추지 않는다, 설계 5.3). */
  const copyAddress = async (label: string) => {
    try {
      await navigator.clipboard.writeText(label);
      toast.success('주소를 복사했습니다');
    } catch {
      toast.error('주소를 복사하지 못했습니다');
    }
  };

  return (
    <div
      ref={setFieldRef}
      // 끌어놓기 판정·테스트가 이 속성으로 칸을 잡는다(각 칸 유일).
      data-field={field}
      // 치던 글자(조각)는 완성되지 않은 동안 이 칸을 떠날 때만 칩으로 굳힌다 — 칸 안의 × 단추나 이 칸의 칩 메뉴로
      // 초점이 옮긴 동안은 아직 이 칸을 쓰는 중이라 굳히지 않는다. 굳히면 칩을 빼는 순간 빨간 칩으로 먼저 남아
      // 치던 글자가 남지 않기 때문이다(WP-2150 반려 ②). 이미 완성된 주소는 굳힌다 — 칸을 떠나며(× 를 눌러) 칸을
      // 잃어도 칩으로 남아야 하는 기존 자동완성 동작이다(mail-recipient-autocomplete E2E).
      onBlur={(e) => {
        const to = e.relatedTarget;
        const staying =
          to instanceof Element &&
          (e.currentTarget.contains(to) ||
            to.closest('[data-recipient-menu]')?.getAttribute('data-recipient-menu') === field);
        if (staying && !isCompleteAddress(text)) return;
        commitText();
      }}
      className={cn(
        'relative flex items-center gap-2 border-b focus-within:border-primary',
        mobile ? 'py-3' : 'pb-2',
        // 끌기 중 — 칸 전체가 놓을 자리다(모바일엔 끌기가 없어 그리지 않는다). 지금 포인터가 올라간 칸은 실선
        // 강조(over, 「지금 놓으면 여기」), 나머지 칸은 점선(allowed, 「놓을 수 있음」) — 두 상태는 같이 붙지 않는다
        // (배경·외곽선이 서로 덮어쓰기 때문). 저장소 공용 규칙(dndDropClass)이라 이슈·드라이브와 같은 시각 언어다(WP-2150).
        dnd?.dragging && !mobile && (isOver ? DROP_TARGET_CLASS.over : DROP_TARGET_CLASS.allowed),
      )}
    >
      {/* 끌기 중에만 뜨는 칸 이름 — 평소 데스크톱에는 칸 이름이 없어 드롭 표시에서만 쓴다(모바일엔 이미 <label> 이 있다). */}
      {dnd?.dragging && !mobile && (
        <span
          data-testid={`${testId}-drop-label`}
          className="absolute -top-2.5 left-0 rounded-full bg-secondary px-1.5 text-[11px] text-secondary-foreground"
        >
          {isOver ? recipientFieldMoveLabel(field) : RECIPIENT_FIELD_LABEL[field]}
        </span>
      )}
      {mobile && (
        <label htmlFor={testId} className="w-16 shrink-0 text-sm text-muted-foreground">
          {label}
        </label>
      )}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {chips.map((chip, i) => (
          <RecipientChipButton
            // 같은 주소를 두 번 넣을 수도 있어 순서를 함께 키로 쓴다.
            key={`${i}-${chip.label}`}
            chip={chip}
            index={i}
            field={field}
            testId={testId}
            mobile={mobile}
            // 이 칸에서 메뉴가 열려 있는 동안은 이 칸의 끌기가 모두 꺼진다(dragEnabled 가 menuIndex 하나를 본다) — 끌기와 메뉴가 같은 단추라.
            menuOpen={menuIndex === i}
            dragEnabled={dragEnabled}
            dnd={dnd}
            onMenuOpenChange={(open) => setMenuIndex(open ? i : null)}
            onMove={moveChip}
            onRemove={removeChip}
            onCopy={copyAddress}
          />
        ))}
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
          // 조각은 위 칸 전체의 onBlur 가 굳힌다 — 입력에서 떠나도 칸 안(× 단추)에 있으면 아직 이 칸을 쓰는 중이다.
          onBlur={() => setFocused(false)}
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
              // 후보만 닫는다 — 전역 Esc(AI 패널 닫기)까지 가지 않게 막는다.
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
