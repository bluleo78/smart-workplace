// 이슈 코멘트 이모지 반응 줄(WP-504) — 본문 아래 칩 + 반응 추가 버튼. 칩·호버 카드·반응자 목록은 채팅 공용 컴포넌트
// (components/reactions)를 그대로 쓴다. 진입점은 합의 시안 "C 혼합":
// - 반응이 있으면 칩 끝에 ＋ 를 늘 보인다(이미 반응이 오가는 코멘트라 바로 더할 수 있게).
// - 반응이 없으면(마우스) 본문 아래엔 아무것도 그리지 않고, 😊+ 는 코멘트 헤더 오른쪽 hover 액션 자리(CommentItem 이
//   AddReactionButton variant="header" 로 렌더)에서 마우스·키보드 포커스 때만 드러난다 — 반응 없는 코멘트에 빈 줄·잡음이 없게.
// - 터치(hover 없음)는 칩 줄 끝 ＋ 를 늘 보이고, 누르면 팝오버 대신 하단 시트(채팅 작업 시트와 같은 이모지 줄)를 연다.
//   반응한 사람은 칩 길게 누르기로 본다(IssueCommentList 가 목록 단위 위임으로 판정).
// - 코멘트 작성 권한이 없으면(canReact=false) 칩은 개수만 보이고 버튼은 없다(반응한 사람 보기는 그대로).
// 반응자 전체 보기 오버레이는 목록(IssueCommentList)이 하나만 가진다 — 호버 카드 모두 보기·길게 누르기가 같은 곳을 연다.
import { Plus, SmilePlus } from 'lucide-react';
import { useRef, useState } from 'react';

import { PICKER_EMOJIS, QUICK_EMOJIS } from '@/components/reactions/emojiSets';
import { QuickReactionRow } from '@/components/reactions/QuickReactionRow';
import { ReactionBar } from '@/components/reactions/ReactionBar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';

import { commentReactorSource } from '../../../hooks/queries/commentReactorSource';
import type { IssueCommentResponse } from '../../../types/issue';

export function CommentReactions({
  comment,
  issueId,
  canReact,
  touch,
  currentUserId,
  onOpenReactors,
  onToggle,
}: {
  comment: IssueCommentResponse;
  issueId: number;
  // 코멘트 작성 권한(IssueDetailResponse.viewerCanEditContent) — 없으면 읽기 전용 칩.
  canReact: boolean;
  // 터치 환경(모바일·coarse pointer) — hover 가 없으니 추가 버튼을 늘 보이고 호버 카드를 붙이지 않는다.
  touch: boolean;
  currentUserId: number;
  // 반응자 전체 보기 열기(데스크톱 호버 카드의 모두 보기) — 오버레이는 목록이 가진다. 터치는 길게 누르기가 맡아 쓰지 않는다.
  onOpenReactors: (emoji: string) => void;
  // 이 코멘트에 emoji 반응 추가·취소 — 토글 훅은 CommentItem 이 하나만 만들어 헤더 버튼과 함께 쓴다.
  onToggle: (emoji: string) => void;
}) {
  // 구버전 서버 응답엔 reactions 가 없을 수 있다.
  const reactions = comment.reactions ?? [];
  const target = { id: comment.id, reactions };
  const source = commentReactorSource(issueId, comment.id);

  // 칩 줄 끝 ＋ — 반응이 있거나 터치일 때만. 마우스 + 반응 0개는 헤더 자리 버튼이 맡아 칩 줄이 아예 없다(공간 0).
  const add =
    canReact && (reactions.length > 0 || touch) ? (
      <AddReactionButton
        commentId={comment.id}
        variant={reactions.length > 0 ? 'chip' : 'chip-empty'}
        touch={touch}
        onPick={onToggle}
      />
    ) : undefined;

  return (
    <ReactionBar
      target={target}
      source={source}
      onToggle={onToggle}
      currentUserId={currentUserId}
      // 터치는 호버 카드가 없다 — 반응자 보기는 칩 길게 누르기(칩의 data-reaction-emoji, 목록 위임)로 연다.
      onOpenReactors={touch ? undefined : onOpenReactors}
      readOnly={!canReact}
      testIdPrefix="comment-"
      trailing={add}
    />
  );
}

/**
 * 반응 추가 버튼 + 팝오버(빠른 6종, 더보기 = 채팅 피커와 같은 40종 그리드). 고르면 토글하고 닫는다.
 * 더보기는 같은 팝오버 안에서 펼친다 — 공용 EmojiPicker 를 겹쳐 띄우면 팝오버 안에 팝오버가 열리고 빠른 6종이 한 번 더 나온다.
 * 터치(touch)는 팝오버 대신 하단 시트 — 채팅 작업 시트와 같은 이모지 줄(QuickReactionRow, 44px 버튼 + ＋ 로 40종 펼침).
 *
 * variant:
 * - 'chip'       — 반응 있는 코멘트의 칩 줄 끝 ＋(늘 보임).
 * - 'chip-empty' — 터치에서 반응 없는 코멘트의 칩 줄 😊+(늘 보임).
 * - 'header'     — 마우스에서 반응 없는 코멘트의 헤더 오른쪽 😊+. 수정·삭제 hover 액션과 같은 관용구로 hover·포커스 때만 드러나고,
 *                  팝오버가 열린 동안(data-state=open)은 마우스가 portal 팝오버로 옮겨 가 hover 가 풀려도 유지한다.
 */
export function AddReactionButton({
  commentId,
  variant,
  touch = false,
  onPick,
}: {
  commentId: number;
  variant: 'chip' | 'chip-empty' | 'header';
  // 터치 환경 — 팝오버 대신 하단 시트로 고른다(손가락 크기 버튼, 화면 폭 전체).
  touch?: boolean;
  onPick: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  // 터치 시트를 연 ＋ 버튼 — SheetTrigger 없이 여는 시트라 Radix 가 닫힘 때 포커스를 되돌려 주지 않는다(onCloseAutoFocus 참조).
  const triggerRef = useRef<HTMLButtonElement>(null);
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    // 다시 열 때는 빠른 6종부터.
    if (!next) setMore(false);
  };
  const pick = (emoji: string) => {
    onPick(emoji);
    onOpenChange(false);
  };
  // 트리거 버튼 — 팝오버(마우스)와 시트(터치)가 같은 모양·testid 를 쓴다.
  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      aria-label="반응 추가"
      title="반응 추가"
      data-testid={`comment-reaction-add-${commentId}`}
      // 터치는 PopoverTrigger 가 없으니 열기·열림 표식(data-state — 열린 동안 강조 스타일)을 직접 단다.
      {...(touch && {
        onClick: () => setOpen(true),
        'aria-haspopup': 'dialog' as const,
        'aria-expanded': open,
        'data-state': open ? 'open' : 'closed',
      })}
      className={
        variant === 'header'
          ? // 헤더: 수정·삭제 아이콘 버튼과 같은 크기의 ghost 아이콘 버튼. 음수 마진으로 남의 코멘트 헤더 줄 높이를 키우지 않는다.
            '-my-0.5 inline-flex h-6 items-center gap-0.5 rounded-md px-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 data-[state=open]:text-primary'
          : // 칩 줄: 칩과 같은 높이·둥근 모양에 점선 테두리 — 칩 끝에 붙어도 칩과 구분된다(시안의 ＋/😊+).
            'flex items-center gap-0.5 rounded-full border border-dashed border-muted-foreground/40 px-2 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary focus-visible:border-primary focus-visible:text-primary focus-visible:outline-none data-[state=open]:border-primary data-[state=open]:text-primary pointer-coarse:min-h-8 pointer-coarse:px-2.5'
      }
    >
      {variant === 'chip' ? (
        <Plus className="size-3.5" />
      ) : (
        <>
          <SmilePlus className="size-3.5" />
          <Plus className="size-3" />
        </>
      )}
    </button>
  );
  if (touch) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent
            side="bottom"
            showCloseButton={false}
            data-testid={`comment-reaction-sheet-${commentId}`}
            className="max-h-[85dvh] gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]"
            // 닫히면(반응 고름·바깥 탭·ESC) 연 ＋ 로 포커스를 되돌린다 — 채팅 작업 시트(MessageActionSheet)와 같은 관용구.
            // 스크린리더·키보드 사용자가 코멘트 목록의 제자리를 잃지 않게. 반응을 달아 ＋ 가 다시 그려졌으면 이어 붙지 않은 요소는 건너뛴다.
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              const el = triggerRef.current;
              if (el?.isConnected) el.focus({ preventScroll: true });
            }}
          >
            <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-muted-foreground/30" />
            <SheetTitle className="sr-only">반응 추가</SheetTitle>
            <SheetDescription className="sr-only">이 코멘트에 달 반응을 고르세요</SheetDescription>
            <QuickReactionRow
              onPick={pick}
              quickTestId={(e) => `comment-reaction-quick-${commentId}-${e}`}
              pickTestId={(e) => `comment-reaction-pick-${commentId}-${e}`}
              moreTestId={`comment-reaction-more-${commentId}`}
            />
          </SheetContent>
        </Sheet>
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        // 헤더 버튼은 카드 오른쪽 끝이라 끝선에 맞춰 왼쪽으로 펼친다(속성 레일을 덮지 않게). 칩 줄은 시작선에 맞춘다.
        align={variant === 'header' ? 'end' : 'start'}
        className="w-auto p-2"
        data-testid={`comment-reaction-popover-${commentId}`}
      >
        <div className="flex items-center gap-1">
          {QUICK_EMOJIS.map((e) => (
            <EmojiButton key={e} emoji={e} testId={`comment-reaction-quick-${commentId}-${e}`} onPick={pick} />
          ))}
          {!more && (
            <button
              type="button"
              className="ml-1 border-l pl-2 text-xs text-muted-foreground hover:text-foreground"
              data-testid={`comment-reaction-more-${commentId}`}
              onClick={() => setMore(true)}
            >
              더보기
            </button>
          )}
        </div>
        {more && (
          <div className="mt-2 grid max-h-40 grid-cols-8 gap-1 overflow-y-auto border-t pt-2">
            {PICKER_EMOJIS.map((e) => (
              <EmojiButton key={e} emoji={e} testId={`comment-reaction-pick-${commentId}-${e}`} onPick={pick} />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** 팝오버 안 이모지 한 칸 — 스크린리더용 이름은 채팅 작업 시트(MessageActionSheet)와 같은 「👍 반응」. */
function EmojiButton({ emoji, testId, onPick }: { emoji: string; testId: string; onPick: (emoji: string) => void }) {
  return (
    <button
      type="button"
      aria-label={`${emoji} 반응`}
      className="rounded p-1 text-lg leading-none hover:bg-muted"
      data-testid={testId}
      onClick={() => onPick(emoji)}
    >
      {emoji}
    </button>
  );
}
