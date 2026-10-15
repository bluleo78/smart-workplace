// 토큰 발급 직후 1회만 노출되는 평문 표시 dialog.
// 닫으면 다시 표시되지 않으므로 destructive 톤 경고 + 복사 버튼을 제공하고,
// Claude Code 는 genia-works 플러그인 설치 안내(WP-378)로 연결한다 — 토큰이 든 명령은 셸 기록에 남으므로 보여 주지 않는다.

// WP-350: 앱 목록은 공유 패키지 소스(순수 모듈 — 번들에 zod·도구 핸들러가 들어오지 않는다)에서 가져와 하드코딩이 어긋나지 않게 한다.
import { TOOL_APPS } from '@smart-workplace/mcp-tools-shared/tool-apps';
import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
import { MCP_ENDPOINT } from '@/lib/mcpEndpoint';
import { buildPluginInstallCommands } from '@/lib/pluginGuide';

import { CopyableCommand } from '../../admin/components/CopyableCommand';
import { PluginServerUrlStep } from '../../admin/components/PluginServerUrlStep';

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
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">1. 플러그인 설치 (Claude Code 안에서)</p>
              <CopyableCommand command={buildPluginInstallCommands()} testId="token-plugin-install-command" />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">2. 토큰 넣기</p>
              <p className="text-xs text-muted-foreground" data-testid="token-plugin-token-step">
                설치하면서 토큰을 물으면 위 토큰을 붙여 넣으세요. 묻지 않았거나 나중에 바꿀 때는{' '}
                <code className="font-mono">/plugin configure genia-works@genia-works</code> 를 실행해 붙여 넣으세요.
              </p>
            </div>
            <PluginServerUrlStep />
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">3. 확인</p>
              <p className="text-xs text-muted-foreground">
                <code className="font-mono">/mcp</code> 에서 genia-works 가 연결됨으로 보이면 끝입니다. 예전에 명령으로
                연결해 두었다면 플러그인이 확인한 뒤 알아서 정리합니다.
              </p>
            </div>

            {/* 플러그인을 못 쓰는 도구(Claude.ai·ChatGPT 등)용 — 기본은 접어 두어 Claude Code 안내가 먼저 보이게 한다. */}
            <Collapsible className="border-t pt-3">
              <CollapsibleTrigger
                className="group flex w-full items-center justify-between text-left text-sm text-muted-foreground hover:text-foreground"
                data-testid="token-other-tools"
              >
                다른 도구로 연결 (Claude.ai, ChatGPT 등)
                <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 pt-2">
                <p className="text-xs text-muted-foreground">연결 주소</p>
                <CopyableCommand command={MCP_ENDPOINT} testId="token-mcp-endpoint" />
                {/* WP-350: 기본 주소는 전체 도구를 싣는다 — Claude·ChatGPT 는 도구 정의를 전부 읽으므로 필요한 앱만, 또는 읽기 전용으로 좁히는 방법을 알린다. */}
                <div className="space-y-1 text-xs text-muted-foreground" data-testid="token-connect-scope-guide">
                  <p>
                    기본 주소(<code className="font-mono">/mcp</code>)는 모든 앱의 도구를 연결합니다. 주소 끝을 바꾸면 범위를 좁힐 수 있습니다.
                  </p>
                  <ul className="list-disc space-y-0.5 pl-4">
                    <li>
                      <code className="font-mono">/mcp/x/issue,wiki</code> — 이슈·노트 도구만
                    </li>
                    <li>
                      <code className="font-mono">/mcp/readonly</code> — 조회 도구만(읽기 전용)
                    </li>
                    <li>
                      <code className="font-mono">/mcp/x/issue,wiki/readonly</code> — 앱 선택 + 읽기 전용
                    </li>
                  </ul>
                  <p>앱: {TOOL_APPS.join(', ')}</p>
                  <p>플러그인에서도 설정 › 서버 주소에 이 주소를 넣으면 범위를 좁힐 수 있습니다.</p>
                </div>
              </CollapsibleContent>
            </Collapsible>
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
