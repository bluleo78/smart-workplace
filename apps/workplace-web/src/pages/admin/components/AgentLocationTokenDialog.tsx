// runner 토큰 1회 표시(WP-1256) — 위치를 만들거나 토큰을 재발급한 직후. 닫으면 다시 볼 수 없다.
// 처음 만든 위치면 설치 순서(README 와 같은 명령)를 함께 보이고, 위치가 「연결됨」으로 바뀌면 대화상자 안에서도 알린다.
// Works 에 내부 IP 로 닿아야 하는 클러스터면 IP 를 넣어 설치 명령에 hostAliases 를 더하고, 연결이 안 될 때 볼 로그 명령도 보인다(WP-1269).

import { useState } from 'react';
import { toast } from 'sonner';

import { CopyableCommand } from '@/components/CopyableCommand';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';

import { useAgentLocations } from '../../../hooks/queries/useAgentRuntime';
import { connectionPill } from '../../../lib/agentRuntimeStatus';
import { copyText } from '../../../lib/copyText';
import { isIpv4, RUNNER_LOGS_COMMAND, runnerInstallSteps } from '../../../lib/runnerInstall';
import type { AgentLocationTokenResponse } from '../../../types/agentRuntime';

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
  // 내부 IP — 설치 명령에는 올바른 IPv4 일 때만 들어간다(runnerInstallSteps 가 거른다). 여기서는 안내 문구만 바꾼다.
  const [internalIp, setInternalIp] = useState('');
  const ip = internalIp.trim();
  const ipInvalid = ip !== '' && !isIpv4(ip);

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
            {issued?.location.name} 연결 토큰
            {pill && (
              <StatusBadge type={pill.type} data-testid="agent-location-token-connection">
                {pill.label}
              </StatusBadge>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">연결 토큰과 설치 순서</DialogDescription>
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
          {showInstall ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="agent-location-internal-ip">Works 에 내부 IP 로 접속하는 경우 (선택)</Label>
                <Input
                  id="agent-location-internal-ip"
                  value={internalIp}
                  onChange={(e) => setInternalIp(e.target.value)}
                  placeholder="예 192.168.100.72"
                  inputMode="decimal"
                  aria-invalid={ipInvalid}
                  aria-describedby="agent-location-internal-ip-hint"
                  className="max-w-xs"
                  data-testid="agent-location-internal-ip"
                />
                <p
                  id="agent-location-internal-ip-hint"
                  role={ipInvalid ? 'alert' : undefined}
                  className={ipInvalid ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
                >
                  {ipInvalid
                    ? 'IPv4 주소(예 192.168.100.72)를 넣으세요.'
                    : `이 클러스터에서 ${window.location.hostname} 에 공인 주소로 닿지 않을 때만 넣습니다. 넣으면 설치 명령에 반영됩니다.`}
                </p>
              </div>
              <ol className="space-y-3" data-testid="agent-location-install-steps">
                {runnerInstallSteps(window.location.origin, __APP_VERSION__, internalIp).map((s, i) => (
                  <li key={s.title} className="space-y-1.5">
                    <p className="text-sm font-medium">
                      {i + 1}. {s.title}
                    </p>
                    <CopyableCommand command={s.command} testId={`agent-location-install-${i + 1}`} />
                    {s.note && <p className="text-xs text-muted-foreground">{s.note}</p>}
                  </li>
                ))}
              </ol>
              <div className="space-y-1.5" data-testid="agent-location-install-troubleshoot">
                {/* 문제 해결 설명은 설정 가이드(실행 환경)로 옮겼다(WP-1281) — 여기엔 칠 명령만 남긴다. */}
                <p className="text-xs text-muted-foreground">연결이 안 될 때 연결 프로그램 기록 보기</p>
                <CopyableCommand command={RUNNER_LOGS_COMMAND} testId="agent-location-install-logs" />
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              클러스터의 연결 프로그램이 새 토큰을 쓰도록 바꾸고 다시 띄우세요. 옛 토큰은 이미 끊겼어요.
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
