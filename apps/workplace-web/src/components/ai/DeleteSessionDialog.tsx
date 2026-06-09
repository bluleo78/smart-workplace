// 대화 삭제 확인 다이얼로그 — 파괴적 작업 보호. AIChatPanel/AIFullscreen 공유.
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

interface Props {
  /** 삭제 대상 세션 id. null 이면 닫힘. */
  sessionId: string | null;
  /** 확인 클릭 → 해당 id 삭제. */
  onConfirm: (id: string) => void;
  /** 취소/바깥 클릭 → 닫기. */
  onCancel: () => void;
}

/** pendingDeleteId 패턴을 캡슐화한 삭제 확인 다이얼로그. */
export function DeleteSessionDialog({ sessionId, onConfirm, onCancel }: Props) {
  return (
    <AlertDialog open={sessionId !== null} onOpenChange={(v) => !v && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>대화 삭제</AlertDialogTitle>
          <AlertDialogDescription>
            이 대화를 삭제하시겠습니까? 삭제된 대화는 복구할 수 없습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          {/* 파괴적 작업 — destructive 스타일로 실수 방지 */}
          <AlertDialogAction variant="destructive" onClick={() => sessionId && onConfirm(sessionId)}>
            삭제
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
