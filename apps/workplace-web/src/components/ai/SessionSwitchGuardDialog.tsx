// 생성 중 대화 전환 확인(WP-191) — 지금은 답변 스트림이 하나뿐이라 전환하면 진행 중 답변이 끊긴다(동시 진행은 WP-190).
// AIChatPanel 안에서 렌더해 WP-54 AI 표면으로 판별된다(DeleteSessionDialog 와 같은 이유).
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

export function SessionSwitchGuardDialog({ open, onWait, onStop }: { open: boolean; onWait: () => void; onStop: () => void }) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onWait()}>
      {/* WP-191: 모바일 AI 시트(z-[60]) 위로 — 딤도 index.css 의 data-ai-confirm 규칙으로 함께 올라간다. */}
      <AlertDialogContent data-ai-confirm className="z-[80]" data-testid="session-switch-guard">
        <AlertDialogHeader>
          <AlertDialogTitle>답변을 만들고 있어요</AlertDialogTitle>
          <AlertDialogDescription>
            지금 이동하면 진행 중인 답변이 멈춰요. 끝날 때까지 기다리면 자동으로 이동해요.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>기다리기</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onStop}>
            중단하고 이동
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
