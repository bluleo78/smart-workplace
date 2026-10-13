// 키 발급 직후 1회만 노출되는 평문 키 표시 dialog.
// 닫으면 다시 표시되지 않으므로 destructive 톤 경고 + 복사 버튼 제공.

import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { CopyableCommand } from './CopyableCommand';

interface AgentKeyIssueDialogProps {
  plaintextKey: string | null;
  // 외부 에이전트면 실제 키가 채워진 "이 AI로 Claude Code 실행" 명령(복사용). 없으면 미표시.
  launchCommand?: string | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

export function AgentKeyIssueDialog({
  plaintextKey,
  launchCommand,
  open,
  onOpenChange,
}: AgentKeyIssueDialogProps) {
  // 키 복사 — 클립보드 API 가용성을 확인하고 실패 시 사용자에게 알린다.
  const onCopy = async () => {
    if (!plaintextKey) return;
    try {
      await navigator.clipboard.writeText(plaintextKey);
      toast.success('키를 복사했습니다');
    } catch {
      toast.error('복사에 실패했습니다. 키를 직접 선택해 복사하세요.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="agent-key-issue-dialog">
        <DialogHeader>
          <DialogTitle>새 API 키</DialogTitle>
          <DialogDescription className="sr-only">새 API 키</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-destructive font-medium">
            이 키는 다시 표시되지 않습니다. 지금 안전한 곳에 저장하세요.
          </p>
          <code
            className="block break-all bg-muted p-3 rounded text-sm font-mono"
            data-testid="agent-key-plaintext"
          >
            {plaintextKey ?? ''}
          </code>
          {launchCommand && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                이 AI로 Claude Code 실행 (연결 설정은 에이전트 상세의 ② 를 한 번 해 두세요)
              </p>
              <CopyableCommand command={launchCommand} testId="agent-key-launch-command" />
            </div>
          )}
          <DialogFooter>
            <Button onClick={onCopy} disabled={!plaintextKey}>
              복사
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              닫기
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
