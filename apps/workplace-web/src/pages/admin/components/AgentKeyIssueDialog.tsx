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

import { buildSwitchCommand, PLUGIN_COMMANDS } from '../../../lib/pluginGuide';

interface AgentKeyIssueDialogProps {
  plaintextKey: string | null;
  // 외부 에이전트의 아이디 — 있으면 플러그인 로그인 안내를 보인다. 키는 명령에 넣지 않는다(셸 기록에 남음).
  username?: string | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

export function AgentKeyIssueDialog({
  plaintextKey,
  username,
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
        <div className="min-w-0 space-y-3">
          <p className="text-sm text-destructive font-medium">
            이 키는 다시 표시되지 않습니다. 지금 안전한 곳에 저장하세요.
          </p>
          <code
            className="block break-all bg-muted p-3 rounded text-sm font-mono"
            data-testid="agent-key-plaintext"
          >
            {plaintextKey ?? ''}
          </code>
          {username && (
            <div className="space-y-1 text-xs text-muted-foreground" data-testid="agent-key-login-guide">
              <p>
                Claude Code 에서 <code className="font-mono">{PLUGIN_COMMANDS.login}</code> › 「새 AI 추가」에 이 키를
                붙여 넣으세요. 이름은 <code className="font-mono">{username}</code>.
              </p>
              <p>
                등록한 뒤에는 <code className="font-mono">{buildSwitchCommand(username)}</code> 로 이 AI 로 일할 수
                있어요. 플러그인이 없다면 에이전트 상세의 ② 를 먼저 하세요.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={onCopy} disabled={!plaintextKey}>
              키 복사
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
