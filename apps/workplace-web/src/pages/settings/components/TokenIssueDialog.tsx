// 토큰 발급 직후 1회만 노출되는 평문 표시 dialog.
// 닫으면 다시 표시되지 않으므로 destructive 톤 경고 + 복사 버튼을 제공하고,
// 외부 도구(Claude Code) 연결을 바로 할 수 있도록 MCP 연결 명령도 함께 안내한다.

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

interface TokenIssueDialogProps {
  plaintextToken: string | null;
  expiresAt: string | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

// dev 기본값은 로컬 workplace-mcp 포트(7090). 배포 환경에서는 VITE_MCP_URL 로 재정의.
const MCP_BASE_URL = (import.meta.env['VITE_MCP_URL'] as string | undefined) ?? 'http://localhost:7090';

export function TokenIssueDialog({
  plaintextToken,
  expiresAt,
  open,
  onOpenChange,
}: TokenIssueDialogProps) {
  // Claude Code 에서 바로 실행 가능한 MCP 연결 명령 — 평문 토큰을 Bearer 헤더로 전달한다.
  const command = `claude mcp add --transport http workplace ${MCP_BASE_URL}/mcp --header "Authorization: Bearer ${plaintextToken ?? '<토큰>'}"`;

  // 클립보드 복사 공통 — 실패 시 사용자에게 알린다.
  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(message);
    } catch {
      toast.error('복사에 실패했습니다. 직접 선택해 복사하세요.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="token-issue-dialog">
        <DialogHeader>
          <DialogTitle>새 API 토큰</DialogTitle>
          <DialogDescription className="sr-only">새 API 토큰</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-destructive font-medium">
            이 토큰은 다시 표시되지 않습니다. 지금 안전한 곳에 저장하세요.
          </p>
          <code
            className="block break-all bg-muted p-3 rounded text-sm font-mono"
            data-testid="token-plaintext"
          >
            {plaintextToken ?? ''}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copy(plaintextToken ?? '', '토큰을 복사했습니다')}
            disabled={!plaintextToken}
          >
            복사
          </Button>

          <p className="text-sm text-muted-foreground" data-testid="token-issue-expiry">
            유효기간: {expiresAt ? new Date(expiresAt).toLocaleDateString('ko-KR') + '까지' : '무기한'}
          </p>

          <div className="space-y-1.5 pt-2">
            <p className="text-sm text-muted-foreground">
              아래 명령으로 Claude Code 에 바로 연결할 수 있습니다.
            </p>
            <code
              className="block break-all bg-muted p-3 rounded text-xs font-mono"
              data-testid="token-connect-command"
            >
              {command}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void copy(command, '연결 명령을 복사했습니다')}
              disabled={!plaintextToken}
            >
              명령 복사
            </Button>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              닫기
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
