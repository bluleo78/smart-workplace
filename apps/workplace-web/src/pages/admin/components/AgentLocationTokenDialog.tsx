// runner 토큰 1회 표시(WP-1256) — 위치를 만들거나 토큰을 재발급한 직후. 닫으면 다시 볼 수 없다.
// 처음 만든 위치면 설치 순서(README 와 같은 명령)를 함께 보이고, 위치가 「연결됨」으로 바뀌면 대화상자 안에서도 알린다.

import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/ui/status-badge';

import { useAgentLocations } from '../../../hooks/queries/useAgentRuntime';
import { connectionPill } from '../../../lib/agentRuntimeStatus';
import { copyText } from '../../../lib/copyText';
import { runnerInstallSteps } from '../../../lib/runnerInstall';
import type { AgentLocationTokenResponse } from '../../../types/agentRuntime';
import { CopyableCommand } from './CopyableCommand';

interface Props {
  issued: AgentLocationTokenResponse | null;
  showInstall: boolean;
  onClose: () => void;
}

export function AgentLocationTokenDialog({ issued, showInstall, onClose }: Props) {
  const locations = useAgentLocations(issued != null);
  // 최신 연결 상태 — 목록을 다시 읽으면 「설치 대기」가 「연결됨」으로 바뀐다.
  const current = locations.data?.find((l) => l.id === issued?.location.id) ?? issued?.location ?? null;
  const pill = current ? connectionPill(current.connection) : null;

  const onCopy = async () => {
    if (!issued) return;
    if (await copyText(issued.plaintextToken)) toast.success('토큰을 복사했습니다');
    else toast.error('복사에 실패했습니다. 토큰을 직접 선택해 복사하세요.');
  };

  return (
    <Dialog open={issued != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" data-testid="agent-location-token-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {issued?.location.name} runner 토큰
            {pill && (
              <StatusBadge type={pill.type} data-testid="agent-location-token-connection">
                {pill.label}
              </StatusBadge>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">runner 토큰과 설치 순서</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-destructive">이 토큰은 다시 표시되지 않습니다. 지금 파일로 저장하세요.</p>
            <code className="block break-all rounded bg-muted p-3 font-mono text-sm" data-testid="agent-location-token-plaintext">
              {issued?.plaintextToken ?? ''}
            </code>
            <Button type="button" size="sm" variant="outline" onClick={() => void onCopy()}>
              토큰 복사
            </Button>
          </div>
          {showInstall && (
            <ol className="space-y-3" data-testid="agent-location-install-steps">
              {runnerInstallSteps(window.location.origin, __APP_VERSION__).map((s, i) => (
                <li key={s.title} className="space-y-1.5">
                  <p className="text-sm font-medium">
                    {i + 1}. {s.title}
                  </p>
                  <CopyableCommand command={s.command} testId={`agent-location-install-${i + 1}`} />
                  {s.note && <p className="text-xs text-muted-foreground">{s.note}</p>}
                </li>
              ))}
            </ol>
          )}
          {!showInstall && (
            <p className="text-sm text-muted-foreground">
              runner 가 쓰는 Secret 을 새 토큰으로 바꾸고 runner 를 다시 띄우세요. 옛 토큰은 이미 끊겼습니다.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>닫기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
