// 제목 인라인 편집 — 표시 모드(텍스트+연필)와 편집 모드(input) 토글.
// 무엇을: 제목을 클릭/연필로 input 으로 전환, Enter·blur 저장, Escape 취소.
//         모바일(commitOnBlur=false)은 blur 저장 없이 Enter·하단 편집 바로 저장(WP-196).
// 왜: 오타·제목 수정을 위해 이슈를 삭제·재생성해야 하는 불편 해소 (#117).
//     이슈 상세 페이지와 개인 작업 드로어가 동일 편집 UI 를 공유하도록 공용화 (#718).
import { Pencil } from 'lucide-react';
import { useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { useAutoGrowTextarea } from '@/hooks/useAutoGrowTextarea';
import { isImeComposing } from '@/lib/imeKey';
import { toSingleLine } from '@/lib/singleLine';
import { cn } from '@/lib/utils';

import { HIT_EXPAND } from './mobile/chipStyles';
import type { EditBarControls } from './mobile/MobileEditBar';
import { useEditBarControls } from './mobile/useEditBarControls';

export function InlineEditableTitle({
  title,
  onSave,
  disabled,
  onEditStart,
  commitOnBlur = true,
  onEditingChange,
}: {
  title: string;
  // Promise<false> 를 돌려주면(저장 실패) 입력한 제목을 버리지 않고 편집을 다시 연다(#611).
  onSave: (next: string) => void | Promise<boolean>;
  disabled: boolean;
  // 편집 진입 알림 — 호출부가 이 시점의 이슈 version 을 저장 기준으로 고정할 때 쓴다(#611).
  onEditStart?: () => void;
  /** false 면 blur 로 저장하지 않는다 — 모바일 편집 바가 저장 경로(WP-196 R5). Enter 저장·Esc 취소는 유지. */
  commitOnBlur?: boolean;
  /** 편집 시작/종료 알림 — 편집 중엔 저장·취소 컨트롤을, 끝나면 null 을 넘긴다(모바일 편집 바). */
  onEditingChange?: (controls: EditBarControls | null) => void;
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
  const commit = () => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false;
      setEditing(false);
      return;
    }
    const trimmed = draft.trim();
    setEditing(false);
    // 왜: zod min(1) 위반(빈 제목)·불변 요청은 무의미하므로 UI 에서 차단.
    if (!trimmed || trimmed === title) return;
    void Promise.resolve(onSave(trimmed)).then((ok) => {
      if (ok === false) setEditing(true);
    });
  };

  // 모바일 편집 textarea 자동 확장 — 긴 제목이 한 줄 input 에서 잘려 보이지 않던 문제(디자인 리뷰).
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useAutoGrowTextarea(textareaRef, draft, editing);

  const cancel = () => setEditing(false);

  // 모바일 하단 편집 바 — 편집 중에만 저장(commit)·취소 컨트롤을 올린다(최신 draft 의 commit 은 훅이 ref 로 부름).
  useEditBarControls(editing, { save: commit, cancel, disabled }, onEditingChange);

  if (!editing) {
    return (
      // 모바일은 긴 제목을 3줄까지 보여준다(한 줄 말줄임이면 편집에 들어가야만 전체를 읽을 수 있었다). 연필은 첫 줄 높이에 맞춘다.
      <span className={cn('flex min-w-0 gap-1', commitOnBlur ? 'items-center' : 'items-start')}>
        <span className={commitOnBlur ? 'truncate' : 'line-clamp-3 break-words'}>{title}</span>
        <button
          type="button"
          onClick={enter}
          disabled={disabled}
          aria-label="제목 편집"
          data-testid="issue-title-edit"
          // 모바일(commitOnBlur=false)은 터치 영역 44px 확보 — HIT_EXPAND 는 세로만 넓히므로 가로는 px-4 -mx-3(아이콘 14px+32px=46px, 음수 마진으로 보이는 위치 유지). 데스크톱 클래스 불변.
          className={cn(
            'shrink-0 rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50',
            !commitOnBlur && [HIT_EXPAND, 'px-4 -mx-3'],
          )}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  if (!commitOnBlur) {
    // 모바일 — 자동 확장 textarea(rows=1). Enter 는 줄바꿈이 아니라 저장(R5), Esc 취소. 한글 조합 중 Enter 는 조합 확정이라 무시.
    // 제목은 한 줄 값이라 붙여넣은 줄바꿈은 공백으로 바꾼다. 글자 크기는 표시 모드(h1 text-2xl)와 같게 — 터치 16px 강제 규칙(index.css)은
    // 16px 미만 확대 방지용이라 24px 는 important 로 덮어도 안전하다.
    return (
      <textarea
        ref={textareaRef}
        autoFocus
        rows={1}
        enterKeyHint="done"
        data-testid="issue-title-input"
        className="block w-full resize-none overflow-hidden rounded-md border border-input bg-transparent px-3 py-1 text-2xl! leading-8 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(toSingleLine(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isImeComposing(e.nativeEvent)) {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            cancel();
          }
        }}
      />
    );
  }

  return (
    <Input
      autoFocus
      data-testid="issue-title-input"
      className="h-8 max-w-md"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        // 데스크톱 — Enter 는 blur 로 단일 저장 경로에 합류, Esc 는 다음 blur 저장을 1회 건너뛴다.
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          skipCommitRef.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
