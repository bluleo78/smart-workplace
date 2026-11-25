// 제목 인라인 편집 — 표시 모드(텍스트+연필)와 편집 모드(input) 토글.
// 무엇을: 제목을 클릭/연필로 input 으로 전환, Enter·blur 저장, Escape 취소.
//         모바일(commitOnBlur=false)은 blur 저장 없이 Enter·하단 편집 바로 저장(WP-196).
// 왜: 오타·제목 수정을 위해 이슈를 삭제·재생성해야 하는 불편 해소 (#117).
//     이슈 상세 페이지와 개인 작업 드로어가 동일 편집 UI 를 공유하도록 공용화 (#718).
import { Pencil } from 'lucide-react';
import { type FocusEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { IssueEditNotice } from '@/components/issue/IssueEditConflictBanner';
import { issueEditConflictBlockedMessage } from '@/components/issue/issueEditField';
import type { EditBarControls } from '@/components/mobile/MobileEditBar';
import { useEditBarControls } from '@/components/mobile/useEditBarControls';
import { Input } from '@/components/ui/input';
import { useAutoGrowTextarea } from '@/hooks/useAutoGrowTextarea';
import { useRestoreFocusOnExit } from '@/hooks/useRestoreFocusOnExit';
import { useSingleLineEnter } from '@/hooks/useSingleLineEnter';
import { isImeComposing } from '@/lib/imeKey';
import { toSingleLine } from '@/lib/singleLine';
import { cn } from '@/lib/utils';
import type { FieldConflict } from '@/pages/projects/hooks/useVersionedPatch';

import { HIT_EXPAND } from './mobile/chipStyles';

// 서버 제목 길이 상한(updateIssueSchema max 200)과 같다 — 입력 단계에서 막아 400 토스트로 알게 되지 않게(WP-459).
const TITLE_MAX_LENGTH = 200;

/** 저장할 제목 — trim 후 비었거나(zod min(1) 위반) 지금 제목과 같으면(불변 요청) 저장할 것이 없어 null. commit·overwrite 가 같은 판정을 쓴다. */
const titleToSave = (draft: string, title: string): string | null => {
  const trimmed = draft.trim();
  return !trimmed || trimmed === title ? null : trimmed;
};

export function InlineEditableTitle({
  title,
  onSave,
  disabled,
  onEditStart,
  commitOnBlur = true,
  wrap = false,
  onEditingChange,
  conflict,
  changedWhileEditing,
  onTakeLatest,
  onOverwrite,
  onEditEnd,
  heading = (content) => content,
}: {
  title: string;
  // Promise<false> 를 돌려주면(저장 실패) 입력한 제목을 버리지 않고 편집을 다시 연다(#611).
  onSave: (next: string) => void | Promise<boolean>;
  disabled: boolean;
  // 편집 진입 알림 — 호출부가 이 시점의 이슈 version 을 저장 기준으로 고정할 때 쓴다(#611).
  onEditStart?: () => void;
  /** false 면 blur 로 저장하지 않는다 — 모바일 편집 바가 저장 경로(WP-196 R5). Enter 저장·Esc 취소는 유지. */
  commitOnBlur?: boolean;
  /** 데스크톱 표시 모드에서 제목을 한 줄 말줄임 대신 줄바꿈해 전부 보인다 — 이슈 상세 본문 제목(WP-462). 드로어 헤더 등 좁은 한 줄 자리는 기본(false). */
  wrap?: boolean;
  /** 편집 시작/종료 알림 — 편집 중엔 저장·취소 컨트롤을, 끝나면 null 을 넘긴다(모바일 편집 바). */
  onEditingChange?: (controls: EditBarControls | null) => void;
  /** WP-2095 — 409 로 남이 먼저 저장한 것이 확인된 필드 충돌. 있으면 입력칸 위에 안내를 띄운다. */
  conflict?: FieldConflict | null;
  /** 편집 중 남이 저장했다 — 최신 값 보기만 안내. */
  changedWhileEditing?: { latest: string } | null;
  /** 「최신 제목으로 다시 쓰기」 — 훅이 기준을 최신으로 옮기고 최신 값을 돌려준다. 입력칸을 그 값으로 바꾼다. 충돌이 없으면 null(입력칸을 그대로 둔다). */
  onTakeLatest?: () => string | null;
  /** 덮어쓰기 확인 뒤 — 훅이 기준을 옮긴 다음 편집기가 지금 입력으로 곧바로 다시 저장한다. */
  onOverwrite?: () => void;
  /** 편집이 끝났다(취소·저장 성공) — 훅이 기준·충돌을 지우게 알린다. */
  onEditEnd?: () => void;
  /**
   * 제목·입력칸을 감쌀 제목 요소(h1 등) — 표시 모드의 제목·연필, 편집 모드의 입력칸만 감싼다.
   * 충돌·그사이 바뀜 안내(role=alert·단추)는 감싸개 밖(앞 형제)에 둔다 — 제목 접근 이름(aria-label)에 안내가 가려지고 제목 안에 컨트롤이 생기는 것을 막는다(WP-2095 리뷰 6).
   * 없으면 감싸지 않는다(기본은 그대로 돌려줌 — 개인 작업 패널·모바일).
   */
  heading?: (content: ReactNode) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  // 무엇을: Escape 직후 발생하는 blur 가 저장을 트리거하지 않도록 1회 스킵 플래그.
  // 왜: setDraft 는 비동기라 blur 핸들러가 stale 값을 보므로, ref 로 결정적으로 취소를 처리.
  const skipCommitRef = useRef(false);

  // 무엇을: 편집 진입 — 현재 값으로 draft 시드.
  const enter = () => {
    setDraft(title);
    setEditing(true);
    onEditStart?.();
  };

  // 무엇을: 단일 저장 경로(blur). Enter 는 blur() 를 호출해 이 경로로 합류.
  // commitOnBlur=false(모바일)면 Enter·편집 바 「저장」이 직접 호출한다.
  // 빈/공백 제목 가드: trim 후 비었거나 변화 없으면 PATCH 없이 표시만 원복.
  // 409 충돌 안내가 떠 있는 동안에는 blur 저장을 하지 않는다(fromBlur) — 안내가 다음 행동(최신으로 다시 쓰기·덮어쓰기)을 이끄는 중이라
  // 다른 곳을 눌렀다고 같은 409 를 되풀이하지 않는다. 저장은 Enter·편집 바 「저장」·덮어쓰기 확인으로 한다.
  // 그사이 바뀜(stale) 안내 중에는 blur 저장을 그대로 한다 — 막으면 다른 곳을 누르고 떠날 때 입력한 제목이 말없이 사라진다.
  // 안내 단추를 눌러 blur 되는 것은 안내가 단추의 mousedown 기본 동작(포커스 이동)을 막아 생기지 않는다(IssueEditConflictBanner).
  // force: 덮어쓰기 확인을 거친 저장 — 충돌 막기를 지난다.
  // 충돌 중 blur 는 아무것도 하지 않는다 — 입력칸에 포커스를 되돌리면 확인 창(포털)·다른 컨트롤의 포커스와 서로 당긴다(리뷰 2).
  const commit = (fromBlur = false, force = false) => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false;
      setEditing(false);
      onEditEnd?.();
      return;
    }
    // 충돌 중에는 blur·Enter·모바일 편집 바 저장 모두 요청을 보내지 않는다 — 덮어쓰기는 안내의 확인 창으로만 한다.
    if (conflict && !force) {
      if (!fromBlur) toast.error(issueEditConflictBlockedMessage('title'));
      return;
    }
    const trimmed = titleToSave(draft, title);
    setEditing(false);
    // 왜: zod min(1) 위반(빈 제목)·불변 요청은 무의미하므로 UI 에서 차단.
    if (trimmed === null) {
      onEditEnd?.();
      return;
    }
    void Promise.resolve(onSave(trimmed)).then((ok) => {
      if (ok === false) setEditing(true);
      else onEditEnd?.();
    });
  };
  // 충돌 안내 [최신 제목으로 다시 쓰기] — 입력칸을 최신 값으로 바꾼다(제목은 짧아 내 글을 따로 남기지 않는다).
  const takeLatest = () => {
    const latest = onTakeLatest?.() ?? null;
    if (latest !== null) setDraft(latest);
  };
  // 충돌 안내 [내 글로 덮어쓰기] 확인 뒤 — 훅이 기준을 옮긴 다음 지금 입력으로 바로 다시 저장한다.
  const overwrite = () => {
    const trimmed = draft.trim();
    // 비운 입력은 저장할 수 없다 — 말없이 창만 닫히지 않게 까닭을 알리고 충돌 안내를 남긴다.
    if (!trimmed) {
      toast.error('제목을 비울 수 없습니다');
      return;
    }
    // 입력이 남의 최신 제목과 같으면 덮어쓸 것이 없다 — 최신으로 받아들이고 편집을 닫는다.
    if (trimmed === conflict?.latest) {
      onTakeLatest?.();
      setEditing(false);
      onEditEnd?.();
      return;
    }
    // title prop 이 최신으로 갱신되지 않는 호출부 대비 — 입력이 prop 제목 그대로면 저장할 것이 없으니 충돌을 풀지 않고 요청도 보내지 않는다.
    // (이슈 상세는 409 뒤 title prop 이 이미 최신이라 위 빈 입력·최신과 같음 분기가 먼저 걸리고 여기는 닿지 않는다.)
    if (trimmed === title) return;
    onOverwrite?.();
    commit(false, true);
  };
  // 입력칸 위 안내 — 409 로 확인된 충돌이 우선, 아니면 편집 중 남이 저장한 사실만 알린다.
  const banner = (
    <IssueEditNotice
      field="title"
      conflict={conflict}
      changedWhileEditing={changedWhileEditing}
      onTakeLatest={onTakeLatest ? takeLatest : undefined}
      onOverwrite={onOverwrite ? overwrite : undefined}
    />
  );

  // 모바일 편집 textarea 자동 확장 — 긴 제목이 한 줄 input 에서 잘려 보이지 않던 문제(디자인 리뷰).
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useAutoGrowTextarea(textareaRef, draft, editing);

  const cancel = () => {
    setEditing(false);
    onEditEnd?.();
  };

  // 입력 포커스 — 저장 실패로 편집을 다시 열 때는 아직 저장 중(disabled)이라 autoFocus 가 먹지 않아
  // 포커스가 body 로 빠지고, 그 상태의 Esc 가 편집 취소 대신 「뒤로」로 상세를 떠났다(WP-459). 입력이 풀리면 다시 맞춘다.
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (editing && !disabled) (inputRef.current ?? textareaRef.current)?.focus();
  }, [editing, disabled]);

  // 편집이 끝나면(Esc 취소·Enter 저장) 입력칸이 사라져 포커스가 body 로 빠졌다 — 「제목 편집」 버튼으로 돌린다(WP-813).
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  useRestoreFocusOnExit(editing, editButtonRef);

  // Enter 저장 — 한글 조합 Enter·macOS Chrome 확정 직후 꼬리 Enter 는 저장으로 보지 않는다(WP-331).
  const enterKey = useSingleLineEnter();

  // 모바일 하단 편집 바 — 편집 중에만 저장(commit)·취소 컨트롤을 올린다(최신 draft 의 commit 은 훅이 ref 로 부름).
  useEditBarControls(editing, { save: () => commit(), cancel, disabled }, onEditingChange);

  if (!editing) {
    const display = (
      // 모바일은 긴 제목을 3줄까지 보여준다(한 줄 말줄임이면 편집에 들어가야만 전체를 읽을 수 있었다). 연필은 첫 줄 높이에 맞춘다.
      // 데스크톱 wrap(WP-462)은 줄 수 제한 없이 전부 보이고, 연필은 첫 줄 가운데(leading-8 32px 기준 mt-1.5)에 맞춘다.
      <span className={cn('flex min-w-0 gap-1', commitOnBlur && !wrap ? 'items-center' : 'items-start')}>
        <span className={cn(!commitOnBlur ? 'line-clamp-3 break-words' : wrap ? 'min-w-0 break-words' : 'truncate')}>{title}</span>
        <button
          ref={editButtonRef}
          type="button"
          // 저장 중 잠금은 disabled 대신 aria-disabled — disabled 가 되면 막 돌아온 포커스가 다시 body 로 빠진다(WP-813).
          onClick={() => {
            if (!disabled) enter();
          }}
          aria-disabled={disabled}
          aria-label="제목 편집"
          data-testid="issue-title-edit"
          // 모바일(commitOnBlur=false)은 터치 영역 44px 확보 — HIT_EXPAND 는 세로만 넓히므로 가로는 px-4 -mx-3(아이콘 14px+32px=46px, 음수 마진으로 보이는 위치 유지). 데스크톱 클래스 불변.
          className={cn(
            'shrink-0 rounded p-1 text-muted-foreground hover:text-foreground aria-disabled:opacity-50 aria-disabled:cursor-not-allowed',
            !commitOnBlur && [HIT_EXPAND, 'px-4 -mx-3'],
            commitOnBlur && wrap && 'mt-1.5',
          )}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </span>
    );
    return heading(display);
  }

  // 모바일 — 자동 확장 textarea(rows=1). Enter 는 줄바꿈이 아니라 저장(R5), Esc 취소. 한글 조합·확정 꼬리 Enter 는 무시.
  // 제목은 한 줄 값이라 붙여넣은 줄바꿈은 공백으로 바꾼다. 글자 크기는 표시 모드(h1 text-2xl)와 같게 — 터치 16px 강제 규칙(index.css)은
  // 16px 미만 확대 방지용이라 24px 는 important 로 덮어도 안전하다.
  const textareaEl = (
    <textarea
      ref={textareaRef}
      autoFocus
      rows={1}
      enterKeyHint="done"
      maxLength={TITLE_MAX_LENGTH}
      aria-label="이슈 제목"
      data-testid="issue-title-input"
      className="block w-full resize-none overflow-hidden rounded-md border border-input bg-transparent px-3 py-1 text-2xl! leading-8 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(toSingleLine(e.target.value))}
      onCompositionEnd={enterKey.onCompositionEnd}
      onKeyDown={(e) => {
        // 조합 중 Esc 는 조합 글자만 버리는 IME 동작 — 편집을 취소하지 않는다.
        if (e.key === 'Escape') {
          if (!isImeComposing(e.nativeEvent)) cancel();
        } else enterKey.handleEnter(e, () => commit());
      }}
    />
  );

  const input = (
    <Input
      ref={inputRef}
      autoFocus
      maxLength={TITLE_MAX_LENGTH}
      aria-label="이슈 제목"
      data-testid="issue-title-input"
      className="h-8 max-w-md"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onCompositionEnd={enterKey.onCompositionEnd}
      onKeyDown={(e) => {
        // 데스크톱 — Enter 는 blur 로 단일 저장 경로에 합류(한글 조합·확정 꼬리 Enter 제외), Esc 는 다음 blur 저장을 1회 건너뛴다.
        if (e.key === 'Escape') {
          // 조합 중 Esc 는 조합 글자만 버리는 IME 동작 — 편집을 취소하지 않는다.
          if (isImeComposing(e.nativeEvent)) return;
          skipCommitRef.current = true;
          e.currentTarget.blur();
        } else {
          // 충돌 중에는 blur 로 가도 저장하지 않으므로 commit 이 안내 토스트만 띄운다.
          enterKey.handleEnter(e, () => (conflict ? commit() : e.currentTarget.blur()));
        }
      }}
    />
  );

  // blur 저장은 입력칸이 아니라 편집 컨테이너의 focusout 으로 받는다 — 포커스가 안내(입력칸 → 안내 단추)로 옮겨 갔다가 안내 밖으로 나가도 저장되게 한다(리뷰 3).
  // 컨테이너 안(입력칸↔안내)으로 옮겨 가는 것은 편집을 끝내려는 게 아니라 무시한다. Esc 의 blur 도 여기로 들어와 skipCommitRef 로 취소된다.
  const containerBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    commit(true);
  };
  // 포커스가 안내 단추에 있을 때의 Esc 도 편집을 취소한다(입력칸의 Esc 는 자기 onKeyDown 이 처리하고 여기까지 버블되면 건너뛴다).
  const containerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || e.target === inputRef.current || e.defaultPrevented) return;
    if (isImeComposing(e.nativeEvent)) return;
    skipCommitRef.current = true;
    commit();
  };
  // 모바일은 저장·취소를 편집 바가 맡아 컨테이너의 blur 저장·Esc 처리가 없고, 데스크톱은 둘 다 컨테이너가 받는다.
  const field = commitOnBlur ? input : textareaEl;
  const containerProps = commitOnBlur ? { onKeyDown: containerKeyDown, onBlur: containerBlur } : {};
  return (
    <div className="space-y-2" {...containerProps}>
      {banner}
      {heading(field)}
    </div>
  );
}
