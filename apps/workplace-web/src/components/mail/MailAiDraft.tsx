// 새 메일 AI 초안(WP-576) 화면 조각 — 빈 본문 칩·툴바 버튼·지시 패널·"AI 초안이에요" 줄·생성 중 본문 자리.
// 상태는 useMailAiDraft 가 갖고, 이 파일은 그리기만 한다. AI 표식은 영역마다 한 번(AiLabel) — 안쪽 버튼엔 기능 아이콘만(디자인 시스템 §7.2).

import { AlertTriangle, Loader2, PenLine, RotateCcw, Square, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

import { AiLabel } from '@/components/ai/AiLabel';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { isImeComposing } from '@/lib/imeKey';
import { COMPOSE_DRAFT_INSTRUCTION_MAX } from '@/lib/mailAiDraft';
import { cn } from '@/lib/utils';

import type { AiDraftError, AiDraftPhase } from './useMailAiDraft';

/** 빈 본문 맨 위 칩 「AI로 초안 쓰기」 — 본문에 글자를 치면 작성창이 걷는다. 위치는 MailComposer 의 본문 덧붙임 자리가 정한다. */
export function AiDraftChip({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="mail-ai-compose-chip"
      // 에디터 초점을 뺏지 않는다 — 누르면 패널 textarea 로 초점이 간다.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded-full border border-ai-accent/40 bg-background px-2.5 py-1 shadow-xs transition-colors hover:bg-ai-accent-subtle pointer-coarse:py-2"
    >
      <AiLabel>AI로 초안 쓰기</AiLabel>
    </button>
  );
}

/**
 * 서식 툴바 오른쪽 끝 「AI로 쓰기」. touch(모바일 하단 툴바)는 44px 높이.
 * marked=false — 지시 패널이나 「AI 초안이에요」 줄이 이미 AI 표식을 보이고 있을 때. AI 표식(✨·AI 색)은 영역마다 한 번이므로(디자인 시스템 §7.2)
 * 버튼엔 기능 아이콘과 글자만 남긴다.
 */
export function AiDraftToolbarButton({
  touch,
  expanded,
  marked,
  onClick,
}: {
  touch: boolean;
  expanded: boolean;
  marked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="mail-ai-compose-open"
      aria-expanded={expanded}
      // 다른 서식 버튼과 같이 에디터 선택을 유지한다.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'ml-auto flex shrink-0 items-center rounded',
        touch ? 'h-11 px-3' : 'px-2 py-1',
        marked
          ? 'hover:bg-ai-accent-subtle'
          : 'gap-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3',
        marked && expanded && 'bg-ai-accent-subtle',
        !marked && expanded && 'bg-accent text-foreground',
      )}
    >
      {marked ? (
        <AiLabel>AI로 쓰기</AiLabel>
      ) : (
        <>
          <PenLine aria-hidden />
          AI로 쓰기
        </>
      )}
    </button>
  );
}

/** 패널 공통 틀 — 옅은 AI 색 테두리 상자. 머리의 AiLabel 이 이 영역 전체를 AI 기능으로 표시한다. */
function PanelBox({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-2 rounded-md border border-ai-accent/30 bg-ai-accent-subtle px-3 py-2.5"
    >
      {children}
    </div>
  );
}

/**
 * 지시 패널 — 제목 줄 아래·본문 바로 위. 단계별로 입력 / 생성 중 / 실패를 보인다.
 * 키: Enter 줄바꿈, ⌘/Ctrl+Enter 생성, Esc 닫기. 한글 조합 중 키는 조합용이라 무시한다.
 */
export function AiDraftPanel({
  phase,
  instruction,
  onInstructionChange,
  hasBody,
  error,
  onGenerate,
  onCancel,
  onStop,
  touch = false,
}: {
  phase: Exclude<AiDraftPhase, 'closed'>;
  instruction: string;
  onInstructionChange: (v: string) => void;
  /** 본문에 이미 글이 있으면 바뀐다는 경고를 띄운다. */
  hasBody: boolean;
  /** 실패 내용 — permanent(계정 AI 꺼짐·비서 미설정)면 다시 시도해도 같아 [닫기]만 보인다. */
  error: AiDraftError | null;
  onGenerate: () => void;
  onCancel: () => void;
  onStop: () => void;
  /** 모바일 — 입력 글자를 다른 모바일 칸(15px)과 맞추고 버튼을 44px 터치 크기로. */
  touch?: boolean;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 모바일 버튼은 44px 터치 높이.
  const buttonClass = touch ? 'h-11 px-4' : undefined;

  // 입력 단계로 올 때마다(처음 열기·다시 쓰기·중지 뒤) 지시 끝에 커서를 둔다.
  useEffect(() => {
    if (phase !== 'input') return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [phase]);

  if (phase === 'generating') {
    return (
      <PanelBox testId="mail-ai-compose-generating">
        <div className="flex items-center gap-2 text-sm" role="status">
          <Loader2 className="size-4 animate-spin text-ai-accent" aria-hidden />
          <span className="min-w-0 flex-1 truncate">AI가 초안을 쓰는 중…</span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className={touch ? 'h-9 px-3' : undefined}
            onClick={onStop}
            data-testid="mail-ai-compose-stop"
          >
            <Square className="fill-current" aria-hidden />
            중지
          </Button>
        </div>
      </PanelBox>
    );
  }

  if (phase === 'error') {
    const permanent = error?.permanent ?? false;
    return (
      <PanelBox testId="mail-ai-compose-error">
        <AiLabel>AI로 초안 쓰기</AiLabel>
        <p className="text-sm text-destructive" role="alert">
          {error?.message}
        </p>
        <div className="flex justify-end gap-2">
          {permanent ? (
            // 영구 사유 — 다시 시도해도 같으므로 닫기만.
            <Button type="button" variant="outline" size="sm" className={buttonClass} onClick={onCancel} data-testid="mail-ai-compose-dismiss">
              닫기
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" size="sm" className={buttonClass} onClick={onCancel}>
                취소
              </Button>
              <Button type="button" variant="outline" size="sm" className={buttonClass} onClick={onGenerate} data-testid="mail-ai-compose-retry">
                <RotateCcw aria-hidden />
                다시 시도
              </Button>
            </>
          )}
        </div>
      </PanelBox>
    );
  }

  const canGenerate = instruction.trim().length > 0;
  return (
    <PanelBox testId="mail-ai-compose-panel">
      <label htmlFor="mail-ai-compose-instruction">
        <AiLabel>AI로 초안 쓰기</AiLabel>
      </label>
      <Textarea
        ref={inputRef}
        id="mail-ai-compose-instruction"
        data-testid="mail-ai-compose-instruction"
        rows={2}
        // 서버 상한(4000자 — 넘으면 400 오류)에 닿지 않게 입력에서 막는다.
        maxLength={COMPOSE_DRAFT_INSTRUCTION_MAX}
        value={instruction}
        onChange={(e) => onInstructionChange(e.target.value)}
        placeholder="어떤 메일을 쓸까요? 예) 다음 주 회의를 목요일로 옮기자고 요청"
        className={cn('min-h-[3.5rem] resize-none focus-visible:ring-offset-0', touch && 'text-[15px]')}
        onKeyDown={(e) => {
          if (isImeComposing(e.nativeEvent)) return;
          if (e.key === 'Escape') {
            // 크게 보기의 Esc(작은 창으로)까지 올라가지 않게 여기서 멈춘다 — 한 번에 하나만 닫힌다.
            e.preventDefault();
            e.stopPropagation();
            onCancel();
            return;
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (canGenerate) onGenerate();
          }
        }}
      />
      {hasBody && (
        <p className="flex items-center gap-1 text-xs text-warning-text" data-testid="mail-ai-compose-replace-warning">
          <AlertTriangle className="size-3 shrink-0" aria-hidden />
          지금 본문을 AI 초안으로 바꿔요
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">받는사람과 제목도 참고해요</span>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="ghost" size="sm" className={buttonClass} onClick={onCancel} data-testid="mail-ai-compose-cancel">
            취소
          </Button>
          {/* 한 창의 주 버튼은 「보내기」 하나 — 패널 안 생성 버튼은 AI 톤 외곽선으로 낮춘다. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn('border-ai-accent/50 text-ai-accent hover:bg-ai-accent-subtle hover:text-ai-accent', buttonClass)}
            disabled={!canGenerate}
            onClick={onGenerate}
            title="⌘/Ctrl+Enter"
            data-testid="mail-ai-compose-generate"
          >
            초안 만들기
          </Button>
        </div>
      </div>
    </PanelBox>
  );
}

/** 완료 뒤 본문 위 얇은 줄 「AI 초안이에요 · 다시 쓰기 · 되돌리기」 — 사용자가 본문을 고치면 걷힌다. */
export function AiDraftBar({ onRewrite, onUndo }: { onRewrite: () => void; onUndo: () => void }) {
  const action =
    'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:py-2 [&_svg]:size-3';
  return (
    <div className="flex items-center gap-1.5" data-testid="mail-ai-compose-bar">
      <AiLabel>AI 초안이에요</AiLabel>
      <span aria-hidden className="text-xs text-muted-foreground">·</span>
      <button type="button" className={action} onClick={onRewrite} data-testid="mail-ai-compose-rewrite">
        <RotateCcw aria-hidden />
        다시 쓰기
      </button>
      <span aria-hidden className="text-xs text-muted-foreground">·</span>
      <button type="button" className={action} onClick={onUndo} data-testid="mail-ai-compose-undo">
        <Undo2 aria-hidden />
        되돌리기
      </button>
    </div>
  );
}

/** 생성 중 빈 본문 자리 — 글줄 모양 스켈레톤(본문에 글이 있으면 대신 흐리게 한다). */
export function AiDraftSkeleton() {
  return (
    <div className="flex flex-col gap-2 pt-1" aria-hidden data-testid="mail-ai-compose-skeleton">
      <Skeleton className="h-3.5 w-1/3" />
      <Skeleton className="h-3.5 w-11/12" />
      <Skeleton className="h-3.5 w-4/5" />
      <Skeleton className="h-3.5 w-2/3" />
    </div>
  );
}
