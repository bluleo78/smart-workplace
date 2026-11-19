// 모바일 이슈 생성 전체 화면 시트(WP-196) — 모달 4필드 한 줄은 값이 잘리고, 키보드가 뜨면 생성 버튼이 가려질 수 있었다.
// 높이 = 보이는 뷰포트(--vvh), 위치 = --vv-top(키보드 열림 시 iOS 팬 보정). 헤더 [취소 · 새 이슈 · 생성] 은 맨 위,
// 속성 칩 줄은 맨 아래 = 키보드 바로 위(키보드 원칙 ①②). 내용이 있으면 닫기 전에 버림 확인.
// DialogContent 대신 원시 Content — index.css 의 [data-slot=dialog-content] 키보드 규칙(가운데 정렬·max-height)을 피한다.
// 설명 칸(WP-1657)은 테두리 없는 본문 모드 RichInput — 붙여넣은 이미지를 칸 안에 그림으로 보이고 원문은 그대로 보낸다.
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useRef, useState } from 'react';

import { RichInput } from '@/components/mentions/RichInput';
import { RawSheetContent, RawSheetRoot } from '@/components/mobile/RawSheetContent';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useAutoGrowTextarea } from '@/hooks/useAutoGrowTextarea';
import { useFocusReturn } from '@/hooks/useFocusReturn';
import { useSheetHistory } from '@/hooks/useSheetHistory';
import { useSingleLineEnter } from '@/hooks/useSingleLineEnter';
import { isRichBodyTarget } from '@/lib/richBodyTarget';
import { normalizeSingleLineInput } from '@/lib/singleLine';

import { ComponentAutoAssignHint } from '../../../../components/components/CreateComponentsField';
import { formatDateMonthDay } from '../../../../lib/formatters';
import { autoAssignHint } from '../../../../lib/issueComponents';
import { useIssueCreateForm } from '../../hooks/useIssueCreateForm';
import { CreateAiHandoffSection } from '../CreateAiHandoffSection';
import type { IssueCreateFormProps } from '../IssueCreateDialog';
import { HIT_EXPAND } from './chipStyles';
import { CreateIssueChips } from './CreateIssueChips';

export function MobileIssueCreateSheet({ projectKey, open, onOpenChange, personal = false, initialTypeId, initialStatusId, initialAgentId, renderProjectField }: IssueCreateFormProps) {
  const f = useIssueCreateForm({ projectKey, open, onOpenChange, initialTypeId, initialStatusId, initialAgentId });
  const { register, watch, formState: { errors } } = f.form;
  // 설명 칸(본문 모드 RichInput)에 넘길 것 — 훅이 메모해 둔 같은 참조들.
  const { ref: bodyEditorRef, bodyMode, imageUpload, members, onBodyChange, onUploadingChange, key: bodyKey, initialBody } = f.bodyEditor;
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // 칩 → 시트 → 직전 입력칸 포커스 복귀(키보드 원칙 ③). 칩 줄과 본문 인라인 입력이 함께 쓴다.
  const focusReturn = useFocusReturn();
  // SUBTASK 면 상위 번호 인라인 입력을 항상 노출(데스크톱과 동일) — 비워 두면 백엔드 400 이라 숨겨 둘 수 없다.
  const parentVisible = f.isSubtaskSelected;
  // ⋯ → 「상위 이슈 번호」: 이미 보이는 입력칸으로 포커스만 옮긴다. ⋯ 시트의 포커스 트랩이 풀린 뒤 실행되도록 다음 프레임에 —
  // 같은 틱에 포커스하면 닫히는 시트가 포커스를 되돌려 가져간다. 입력칸은 register 로 RHF 가 DOM ref 를 쥐고 있어 setFocus 로 충분하다.
  const focusParent = () => requestAnimationFrame(() => f.form.setFocus('parentNumber'));
  const startDate = watch('startDate');
  const title = watch('title') ?? '';
  // 시스템 back 으로 닫기(WP-222) — 빈 시트는 시트만 닫고, 내용이 있으면 버림 확인을 띄운다(항목은 훅이 다시 심는다).
  useSheetHistory({
    historyKey: 'issueCreate', open, hasContent: f.hasContent,
    onClose: () => onOpenChange(false), onBlockedBack: () => setConfirmDiscard(true),
  });
  // 닫기 요청 공통 경로 — 내용이 있으면 확인, 없으면 바로 닫는다(취소 버튼·Esc).
  const requestClose = () => {
    if (f.hasContent) setConfirmDiscard(true);
    else onOpenChange(false);
  };
  // 제목은 자동 확장 textarea — 한 줄 input 은 긴 제목이 오른쪽에서 잘려 끝을 볼 수 없었다(디자인 리뷰). 설명 칸(편집칸)은 내용 높이로 스스로 자란다.
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const titleField = register('title');
  useAutoGrowTextarea(titleRef, title, open);
  // 제목 Enter → 설명으로 이동. 한글 조합 Enter·macOS Chrome 확정 직후 꼬리 Enter 는 이동으로 보지 않는다(WP-331).
  const titleEnter = useSingleLineEnter();

  return (
    <RawSheetRoot open={open} onOpenChange={(o) => { if (!o) requestClose(); }}>
      <DialogPrimitive.Portal>
        <RawSheetContent
          data-testid="issue-create-sheet"
          aria-describedby={undefined}
          // Esc — 시트는 늘 스스로 닫지 않는다(내용이 있으면 버림 확인). 설명 칸 안의 Esc 는 칸(RichInput)에 맡긴다 —
          // 멘션 팝업이 열려 있으면 팝업만 닫고, 아니면 onCancel(=requestClose). 칸 밖 Esc 는 바로 닫기 요청.
          onEscapeKeyDown={(e) => { e.preventDefault(); if (!isRichBodyTarget(e.target)) requestClose(); }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed inset-x-0 top-[var(--vv-top,0px)] z-50 flex h-[var(--vvh,100dvh)] flex-col bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] outline-none [:root[data-keyboard-open]_&]:pb-0"
        >
          <form onSubmit={f.onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
            {/* 헤더 — 좌우 16px 거터(px-4). 취소는 -ml-3 으로 글자를 거터에 맞추고(버튼 패딩만큼 당김),
                생성은 보이는 높이 36px(h-9) + HIT_EXPAND 로 터치 영역 44px 유지. */}
            <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4">
              <Button type="button" variant="ghost" className="-ml-3 h-11 px-3" onClick={requestClose} data-testid="issue-create-cancel">취소</Button>
              <DialogPrimitive.Title className="text-[17px] font-semibold">새 이슈</DialogPrimitive.Title>
              <Button
                type="submit"
                className={`${HIT_EXPAND} h-9 px-4`}
                disabled={!title.trim() || f.isSubmitting || (f.aiActions && f.ai.loading)}
                data-testid="issue-create-submit"
              >
                {/* AI 에게 맡겼으면(WP-1315) 「만들고 지금 실행」 — 「만들기만」은 맡기기 칸 아래에 있다. 담당 AI 후보를 받는 중이면 잠근다. */}
                {f.aiActions
                  ? f.isCreating ? '만드는 중…' : '만들고 지금 실행'
                  : f.isCreating ? '생성 중…' : '생성'}
              </Button>
            </header>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {/* 프로젝트 고르기(WP-1768) — 프로젝트 없이 연 시트만. 유형·담당 AI 후보가 이 값에 따라 바뀌어 맨 위에 둔다. */}
              {renderProjectField?.(f.projectLocked)}
              {/* 제목 — Enter 는 줄바꿈 대신 설명으로 이동(enterKeyHint=next). 한글 조합 중 Enter 는 조합 확정이라 무시.
                  제목은 한 줄 값이라 붙여넣은 줄바꿈은 공백으로. 글자 크기 20px 는 터치 16px 강제 규칙(index.css, 확대 방지)보다 커서 important 로 덮는다. */}
              <textarea
                {...titleField}
                ref={(el) => { titleField.ref(el); titleRef.current = el; }}
                rows={1}
                autoFocus
                enterKeyHint="next"
                aria-label="제목"
                aria-invalid={!!errors.title || undefined}
                aria-describedby={errors.title ? 'issue-create-title-error' : undefined}
                placeholder="제목"
                maxLength={200}
                data-testid="issue-create-title"
                onChange={(e) => {
                  normalizeSingleLineInput(e.target);
                  void titleField.onChange(e);
                }}
                onCompositionEnd={titleEnter.onCompositionEnd}
                onKeyDown={(e) => {
                  // 설명 칸 끝으로 바로 포커스 — 키 처리(사용자 제스처) 안에서 옮겨야 iOS 가 키보드를 내리지 않고 유지한다.
                  titleEnter.handleEnter(e, () => bodyEditorRef.current?.focus());
                }}
                className="block w-full resize-none overflow-hidden bg-transparent text-xl! leading-7 font-semibold outline-none placeholder:text-muted-foreground"
              />
              {errors.title && (
                <p id="issue-create-title-error" role="alert" className="text-sm text-destructive">
                  {errors.title.message}
                </p>
              )}
              {/* 설명 — 본문 모드 RichInput(테두리 없음, 최소 3줄, 최대 높이 없음 — 시트 본문이 스크롤한다). 붙여넣은 이미지는 칸 안 그림.
                  이미지 버튼은 지금처럼 없다(붙여넣기만). 시트가 열릴 때마다 새로 마운트돼 빈 칸으로 시작한다.
                  시트 안에서 프로젝트를 바꾸면(WP-1768) key 가 바뀌어 새 프로젝트 설정으로 다시 마운트되고 지금 설명(initialBody)을 잇는다. */}
              <RichInput
                key={bodyKey}
                ref={bodyEditorRef}
                // 설명 칸 모양 — 테두리 없이 글자만(bare). 바깥 시트가 이미 칸을 그려 둔다(편집칸은 마운트 때 한 번만 읽는다).
                bodyMode={{ ...bodyMode, frame: 'bare' }}
                imageUpload={imageUpload}
                members={members}
                initialBody={initialBody}
                ariaLabel="설명"
                placeholder="설명 (선택)"
                inputTestId="issue-create-body"
                submitTestId="issue-create-body-submit"
                editorAria={{ invalid: !!errors.body, describedBy: errors.body ? 'issue-create-body-error' : undefined }}
                editorMaxHeightClass=""
                onBodyChange={onBodyChange}
                onUploadingChange={onUploadingChange}
                // Cmd/Ctrl+Enter — 헤더 「생성」과 같은 폼 제출 경로(제목 검사·업로드 중 막기).
                onSubmit={() => void f.onSubmit()}
                onCancel={requestClose}
              />
              {/* 본문 상한(5만자) 초과 검증 실패를 그리지 않으면 「만들기」가 아무 반응 없이 멈춘다(WP-929·WP-885). */}
              {errors.body && (
                <p id="issue-create-body-error" role="alert" className="text-sm text-destructive">
                  {errors.body.message}
                </p>
              )}
              {parentVisible && !f.intakeOnly && (
                <div className="space-y-1">
                  <label htmlFor="create-parent-number" className="text-xs font-medium text-muted-foreground">상위 이슈 번호</label>
                  <input
                    id="create-parent-number"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    data-testid="create-parent-number"
                    aria-invalid={!!errors.parentNumber || undefined}
                    aria-describedby={errors.parentNumber ? 'create-parent-number-error' : undefined}
                    {...register('parentNumber', { valueAsNumber: true })}
                    className="h-11 w-full rounded-md border bg-background px-3 text-base"
                  />
                  {errors.parentNumber && (
                    <p id="create-parent-number-error" role="alert" className="text-sm text-destructive">
                      {errors.parentNumber.message}
                    </p>
                  )}
                </div>
              )}
              {/* 보드 컬럼에서 연 경우 그 상태로 만들어진다는 것을 알린다(WP-464). */}
              {f.statusNote && <p className="text-sm text-muted-foreground" data-testid="create-status-note">상태: {f.statusNote}</p>}
              {startDate && <p className="text-sm text-muted-foreground">시작일 {formatDateMonthDay(startDate)}</p>}
              {errors.startDate && <p role="alert" className="text-sm text-destructive">{errors.startDate.message}</p>}
              {f.classifyReason && <p data-testid="create-ai-reason" className="line-clamp-2 text-xs text-muted-foreground">✦ {f.classifyReason}</p>}
              {/* AI 에게 맡기기(WP-1315) — 설명 아래 늘 보이는 한 줄(데스크톱은 마감일 아래). 「만들기만」은 헤더 주 버튼 대신 여기 둔다. */}
              {!f.intakeOnly && (
                <div className="space-y-2">
                  <CreateAiHandoffSection ai={f.ai} disabled={f.isSubmitting} />
                  {f.aiActions && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full"
                      disabled={!title.trim() || f.isSubmitting || f.ai.loading}
                      onClick={() => void f.onSubmitOnly()}
                      data-testid="create-only"
                    >
                      만들기만
                    </Button>
                  )}
                </div>
              )}
            </div>
            {/* 구성요소 자동 지정 안내(WP-933) — 구성요소 칩이 있는 맨 아래 칩 줄 바로 위에 붙여, 칩과 안내가 떨어져 보이지 않게 한다.
                담당자를 이미 골랐으면 자동 지정이 일어나지 않으므로 숨긴다(안내가 없으면 아무것도 그리지 않는다). */}
            {f.showComponents && (
              <div className="shrink-0 px-4 pb-2">
                <ComponentAutoAssignHint
                  hint={autoAssignHint(f.componentIds, f.componentList, (watch('assigneeIds') ?? []).length > 0)}
                />
              </div>
            )}
            <div className="min-h-14 shrink-0 border-t bg-background" data-testid="issue-create-chips">
              {/* OPEN 프로젝트 비멤버는 접수만 한다(WP-477) — 속성 칩 대신 안내 한 줄. */}
              {f.intakeOnly ? (
                <p className="px-4 py-4 text-sm text-muted-foreground" data-testid="create-intake-notice">우선순위·일정은 처리팀이 정합니다</p>
              ) : (
                <CreateIssueChips projectKey={projectKey} personal={personal} f={f} focusReturn={focusReturn} onFocusParent={focusParent} />
              )}
            </div>
          </form>
        </RawSheetContent>
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
    </RawSheetRoot>
  );
}
