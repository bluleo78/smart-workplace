// 모바일 이슈 생성 전체 화면 시트(WP-196) — 모달 4필드 한 줄은 값이 잘리고, 키보드가 뜨면 생성 버튼이 가려질 수 있었다.
// 높이 = 보이는 뷰포트(--vvh), 위치 = --vv-top(키보드 열림 시 iOS 팬 보정). 헤더 [취소 · 새 이슈 · 생성] 은 맨 위,
// 속성 칩 줄은 맨 아래 = 키보드 바로 위(키보드 원칙 ①②). 내용이 있으면 닫기 전에 버림 확인.
// DialogContent 대신 원시 Content — index.css 의 [data-slot=dialog-content] 키보드 규칙(가운데 정렬·max-height)을 피한다.
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useLayoutEffect, useState } from 'react';

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useFocusReturn } from '@/hooks/useFocusReturn';

import { formatDateMonthDay } from '../../../../lib/formatters';
import { useIssueCreateForm } from '../../hooks/useIssueCreateForm';
import { CreateIssueChips } from './CreateIssueChips';

type Props = { projectKey: string; open: boolean; onOpenChange: (v: boolean) => void; personal?: boolean; initialTypeId?: number };

export function MobileIssueCreateSheet({ projectKey, open, onOpenChange, personal = false, initialTypeId }: Props) {
  const f = useIssueCreateForm({ projectKey, open, onOpenChange, personal, initialTypeId });
  const { register, watch, formState: { errors } } = f.form;
  const { bodyRef, bodyField } = f;
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // 칩 → 시트 → 직전 입력칸 포커스 복귀(키보드 원칙 ③). 칩 줄과 본문 인라인 입력이 함께 쓴다.
  const focusReturn = useFocusReturn();
  // SUBTASK 상위 번호 인라인 입력 노출 — ⋯ 시트 「상위 이슈 번호」로 켠다. 열릴 때마다 닫힌 상태로 시작(렌더 중 상태 조정, effect 불필요).
  const [showParent, setShowParent] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setShowParent(false);
  }
  // 상위 번호를 안 넣고 생성해 zod 오류가 나면 숨은 칸에 묻히지 않도록 입력을 드러낸다.
  const parentVisible = f.isSubtaskSelected && (showParent || !!errors.parentNumber);
  const startDate = watch('startDate');
  const title = watch('title') ?? '';
  const body = watch('body') ?? '';
  // 닫기 요청 공통 경로 — 내용이 있으면 확인, 없으면 바로 닫는다(취소 버튼·Esc).
  const requestClose = () => {
    if (f.hasContent) setConfirmDiscard(true);
    else onOpenChange(false);
  };
  // 설명 자동 확장 — 내용 높이에 맞춰 늘린다(최소 3줄은 rows=3). field-sizing 은 iOS 지원이 고르지 않아 JS 로.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [body, bodyRef]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => { if (!o) requestClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          data-testid="issue-create-sheet"
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => { e.preventDefault(); requestClose(); }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed inset-x-0 top-[var(--vv-top,0px)] z-50 flex h-[var(--vvh,100dvh)] flex-col bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] outline-none [:root[data-keyboard-open]_&]:pb-0"
        >
          <form onSubmit={f.onSubmit} className="flex min-h-0 flex-1 flex-col">
            <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-2">
              <Button type="button" variant="ghost" className="h-11 px-3" onClick={requestClose} data-testid="issue-create-cancel">취소</Button>
              <DialogPrimitive.Title className="text-[17px] font-semibold">새 이슈</DialogPrimitive.Title>
              <Button type="submit" className="h-11 px-4" disabled={!title.trim() || f.isSubmitting} data-testid="issue-create-submit">
                {f.isCreating ? '생성 중…' : '생성'}
              </Button>
            </header>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <input
                {...register('title')}
                autoFocus
                aria-label="제목"
                placeholder="제목"
                maxLength={200}
                data-testid="issue-create-title"
                className="w-full bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground"
              />
              {errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}
              <textarea
                {...bodyField}
                ref={(el) => { bodyField.ref(el); bodyRef.current = el; }}
                rows={3}
                aria-label="설명"
                placeholder="설명 (선택)"
                data-testid="issue-create-body"
                onPaste={f.images.onPaste}
                className="w-full resize-none overflow-hidden bg-transparent text-base leading-6 outline-none placeholder:text-muted-foreground"
              />
              {parentVisible && (
                <div className="space-y-1">
                  <label htmlFor="create-parent-number" className="text-xs font-medium text-muted-foreground">상위 이슈 번호</label>
                  <input
                    id="create-parent-number"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    autoFocus
                    data-testid="create-parent-number"
                    {...register('parentNumber', { valueAsNumber: true })}
                    className="h-11 w-full rounded-md border bg-background px-3 text-base"
                  />
                  {errors.parentNumber && <p className="text-sm text-destructive">{errors.parentNumber.message}</p>}
                </div>
              )}
              {startDate && <p className="text-sm text-muted-foreground">시작일 {formatDateMonthDay(startDate)}</p>}
              {errors.startDate && <p className="text-sm text-destructive">{errors.startDate.message}</p>}
              {f.classifyReason && <p data-testid="create-ai-reason" className="line-clamp-2 text-xs text-muted-foreground">✦ {f.classifyReason}</p>}
            </div>
            <div className="min-h-14 shrink-0 border-t bg-background" data-testid="issue-create-chips">
              <CreateIssueChips projectKey={projectKey} personal={personal} f={f} focusReturn={focusReturn} onShowParent={() => setShowParent(true)} />
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent data-testid="issue-create-discard-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>작성 중인 내용을 버릴까요?</AlertDialogTitle>
            <AlertDialogDescription>입력한 제목과 설명이 사라집니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="issue-create-discard-keep">계속 작성</AlertDialogCancel>
            <AlertDialogAction variant="destructive" data-testid="issue-create-discard-confirm" onClick={() => { setConfirmDiscard(false); onOpenChange(false); }}>
              버리기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DialogPrimitive.Root>
  );
}
