// 모바일 「뷰 ▾」 시트(WP-194) — 저장된 뷰 목록 + 「완료 모두 보기」 + 「현재 조건으로 뷰 저장/업데이트」.
// 뷰 상태·dirty 판정은 데스크톱 ViewChipBar 와 같은 useSavedViewState 를 쓴다. 뷰 수정·삭제·고정은 데스크톱 전용.
import { Check, RefreshCw, Star, Users } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

import type { IssueFilterControls } from '../../hooks/useIssueFilterControls';
import type { SavedViewState } from '../../hooks/useSavedViewState';
import { SaveViewDialog } from '../SaveViewDialog';

// 시트 행 공통 스타일 — 터치 영역 44px.
const ROW = 'flex min-h-11 w-full items-center gap-3 px-4 text-left text-base active:bg-accent disabled:opacity-50';

export function MobileViewSheet({
  open,
  onClose,
  projectKey,
  controls,
  saved,
}: {
  open: boolean;
  onClose: () => void;
  projectKey: string;
  controls: IssueFilterControls;
  saved: SavedViewState;
}) {
  // 뷰 저장 다이얼로그 — 시트를 닫은 뒤 연다(시트·다이얼로그 동시 표시 금지).
  const [saveOpen, setSaveOpen] = useState(false);
  const activeView = saved.activeView;
  const closedChecked = controls.filters.showAllClosed || controls.closedHidingOverridden;

  // 항목 선택 — 시트를 먼저 닫고 적용한다.
  const pick = (apply: () => void) => {
    onClose();
    apply();
  };
  const openSave = () => {
    onClose();
    setSaveOpen(true);
  };

  // 뷰 항목 한 줄 — 활성은 ✓, 공유는 👥, 고정은 ★.
  const option = (testId: string, label: ReactNode, active: boolean, onClick: () => void, extra?: ReactNode) => (
    <button
      key={testId}
      type="button"
      data-testid={testId}
      aria-current={active || undefined}
      onClick={onClick}
      className={cn(ROW, active && 'bg-accent font-medium', '[&_svg]:size-4 [&_svg]:shrink-0')}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {extra}
      {active && <Check className="text-primary" aria-hidden="true" />}
    </button>
  );

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          data-testid="mobile-view-sheet"
          className="flex max-h-[85dvh] flex-col gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]"
          onCloseAutoFocus={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30" />
          <SheetTitle className="px-4 pb-2 pt-3 text-base">뷰</SheetTitle>
          <SheetDescription className="sr-only">저장된 뷰를 고르거나 현재 조건을 뷰로 저장하세요.</SheetDescription>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {option('mobile-view-option-all', '전체', saved.isAllActive, () => pick(saved.applyAll))}
            {saved.views.map((v) =>
              option(
                `mobile-view-option-${v.id}`,
                v.name,
                saved.isViewActive(v),
                () => pick(() => saved.apply(v.query)),
                <>
                  {v.visibility === 'SHARED' && <Users className="text-muted-foreground" aria-label="공유" />}
                  {v.pinned && <Star className="fill-current text-muted-foreground" aria-label="고정" />}
                </>,
              ),
            )}

            {controls.showClosedToggle && (
              <>
                <div className="my-1 border-t" />
                {/* 「완료 모두 보기」 — 시트를 닫지 않고 바로 토글. 명시 필터가 이미 숨김을 해제했으면 켜진 채 비활성(#876). */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={closedChecked}
                  disabled={controls.closedHidingOverridden}
                  onClick={controls.toggleShowAllClosed}
                  data-testid="mobile-view-closed-toggle"
                  className={ROW}
                >
                  <span className="min-w-0 flex-1">완료 모두 보기</span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'relative inline-flex h-6 w-10 shrink-0 rounded-full transition-colors',
                      closedChecked ? 'bg-primary' : 'bg-muted-foreground/30',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 size-5 rounded-full bg-background shadow transition-transform',
                        closedChecked ? 'translate-x-[18px]' : 'translate-x-0.5',
                      )}
                    />
                  </span>
                </button>
              </>
            )}

            <div className="my-1 border-t" />
            {/* 저장 영역(#777 과 같은 규칙) — 활성 뷰가 바뀌었으면 업데이트/새로 저장, 아니면 현재 조건 저장. */}
            {activeView && saved.isViewDirty ? (
              <>
                <button
                  type="button"
                  data-testid="mobile-view-update"
                  onClick={() => pick(() => saved.updateActiveView(activeView))}
                  className={cn(ROW, 'text-primary')}
                >
                  <RefreshCw className="size-4 shrink-0" aria-hidden="true" />
                  뷰 업데이트
                </button>
                <button type="button" data-testid="mobile-view-save" onClick={openSave} className={ROW}>
                  새 뷰로 저장
                </button>
              </>
            ) : (
              <button
                type="button"
                data-testid="mobile-view-save"
                onClick={openSave}
                disabled={saved.hasNothingToSave || (!!activeView && !saved.isViewDirty)}
                className={ROW}
              >
                현재 조건으로 뷰 저장
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <SaveViewDialog projectKey={projectKey} query={saved.currentQuery} open={saveOpen} onOpenChange={setSaveOpen} />

      {/* 공유 뷰 업데이트 확인 — ViewChipBar 와 같은 문구. 데스크톱 바와 동시에 마운트되지 않는다. */}
      <AlertDialog
        open={saved.updateConfirmTarget !== null}
        onOpenChange={(o) => {
          if (!o) saved.setUpdateConfirmTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>공유된 뷰 업데이트</AlertDialogTitle>
            <AlertDialogDescription>
              &apos;{saved.updateConfirmTarget?.name}&apos;은(는) 공유된 뷰입니다. 지금 업데이트하면 변경된 필터가
              이 뷰를 보는 다른 사람에게도 즉시 반영됩니다. 계속하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction data-testid="update-view-confirm" onClick={saved.confirmUpdate}>
              업데이트
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
