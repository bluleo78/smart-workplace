// 키 발급 직후 1회만 노출되는 평문 키 표시 dialog.
// 닫으면 다시 표시되지 않으므로 destructive 톤 경고 + 복사 버튼 제공.
// 도움말 문맥(WP-1507): 외부 방식(아이디가 있음)이면 「외부 도구에 연결한다」, 아니면 「접속 키를 관리한다」 절로 잇는다 — 플러그인 설치 순서는 그 절에 있다.

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

import { copyText } from '../../../lib/copyText';
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
  // 키 복사 — 클립보드 API 가 없으면 대체 경로(copyText)로 시도하고, 그래도 실패하면 사용자에게 알린다.
  const onCopy = async () => {
    if (!plaintextKey) return;
    if (await copyText(plaintextKey)) toast.success('키를 복사했습니다');
    else toast.error('복사에 실패했습니다. 키를 직접 선택해 복사하세요.');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="agent-key-issue-dialog" data-help={username ? 'agent.run.keys.connect' : 'agent.run.keys'}>
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
                있어요.
              </p>
              {/* 모달이 열린 동안엔 도움말 패널을 열 수 없다 — 키를 잃지 않게 먼저 복사하고, 닫은 뒤 상세의 「연결 방법」(15장 agent.run.keys 와 같은 말)으로 보낸다. */}
              <p>플러그인을 아직 설치하지 않았으면 키를 먼저 복사한 뒤 창을 닫고 「접속 키」 아래의 「연결 방법」 을 누르세요.</p>
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
