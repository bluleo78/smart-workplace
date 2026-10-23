// 토큰 발급 직후 1회만 노출되는 평문 표시 dialog.
// 닫으면 다시 표시되지 않으므로 destructive 톤 경고 + 복사 버튼을 제공하고,
// 연결 안내는 TokenConnectGuide(WP-875) — API 토큰 화면과 같이 쓴다.

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
import { copyText } from '@/lib/copyText';
import { formatDateShort } from '@/lib/formatters';

import { TokenConnectGuide } from './TokenConnectGuide';

interface TokenIssueDialogProps {
  plaintextToken: string | null;
  expiresAt: string | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

export function TokenIssueDialog({
  plaintextToken,
  expiresAt,
  open,
  onOpenChange,
}: TokenIssueDialogProps) {
  // 클립보드 복사 공통 — 실패 시 사용자에게 알린다.
  const copy = async (text: string, message: string) => {
    if (await copyText(text)) toast.success(message);
    else toast.error('복사에 실패했습니다. 직접 선택해 복사하세요.');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="token-issue-dialog">
        <DialogHeader>
          <DialogTitle>새 API 토큰</DialogTitle>
          <DialogDescription className="sr-only">새 API 토큰</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-3">
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
            data-testid="token-copy"
          >
            토큰 복사
          </Button>

          <p className="text-sm text-muted-foreground" data-testid="token-issue-expiry">
            유효기간: {expiresAt ? formatDateShort(expiresAt) + '까지' : '무기한'}
          </p>

          <div className="space-y-3 pt-2">
            <p className="text-sm font-medium">Claude Code 에 연결</p>
            {/* 안내는 API 토큰 화면 섹션과 같은 공용 컴포넌트(WP-875). 모달은 기존 testId(token-*)·「위 토큰」 문구를 그대로 쓴다.
                발급 직후 모달은 화면 섹션 위에 함께 열리므로 서버 주소 단계 testId 는 기존 plugin-server-url 로 둔다. */}
            <TokenConnectGuide tokenSource="issued" testIdPrefix="token" serverUrlTestId="plugin-server-url" />
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
