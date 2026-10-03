// 공유(SHARED) 뷰 업데이트 확인 대화상자(#777) — 갱신이 다른 사람에게도 즉시 반영되므로 즉시 실행 대신 한 번 확인시킨다.
// 데스크톱 ViewChipBar 와 모바일 뷰 시트가 공유한다(WP-194). 열림·확인 동작은 useSavedViewState 가 쥔다.
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

import type { SavedViewState } from '../hooks/useSavedViewState';

export function SharedViewUpdateConfirm({
  saved,
}: {
  saved: Pick<SavedViewState, 'updateConfirmTarget' | 'setUpdateConfirmTarget' | 'confirmUpdate'>;
}) {
  return (
    <AlertDialog
      open={saved.updateConfirmTarget !== null}
      onOpenChange={(open) => {
        if (!open) saved.setUpdateConfirmTarget(null);
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
  );
}
