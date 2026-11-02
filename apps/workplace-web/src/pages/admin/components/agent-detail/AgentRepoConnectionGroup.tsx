// 에이전트 상세 「실행」 › 「저장소 연결」 묶음(WP-1268, 바로 반영) — 이 AI 가 코드를 받고 PR 을 올릴 저장소 호스트마다 토큰을 연결한다.
// 행: 맡는 프로젝트 저장소에서 읽은 호스트(필요한 것 먼저) ∪ 이미 등록된 호스트. 연결돼 있으면 다시 연결·연결 끊기, 아니면 연결하기.
// 토큰은 서버가 암호화해 저장하고 다시 돌려주지 않는다 — 입력한 원문은 저장하거나 닫으면 화면 상태에서 바로 지운다.

import { X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

import {
  useAgentRepoCredentials,
  useAgentRuntimeProjects,
  useRegisterAgentRepoCredential,
  useRevokeAgentRepoCredential,
} from '../../../../hooks/queries/useAgentRuntime';
import { formatMonthDayClock, formatRelativeTime } from '../../../../lib/formatters';
import { guessRepoKind, normalizeRepoHost, type RepoConnectionRow, repoConnectionRows } from '../../../../lib/repoHosts';
import type { RepoKind } from '../../../../types/agentRuntime';

/** 종류 이름 — 배지·라디오에 같은 표기. */
const KIND_LABEL: Record<RepoKind, string> = { GITHUB: 'GitHub', GITLAB: 'GitLab' };

/** 토큰 길이 하한 — 서버 검증(16~2048자)과 같다. */
const TOKEN_MIN = 16;
const TOKEN_MAX = 2048;

/** 대화상자 안내 — 어떤 토큰을 만들어 붙이는지. */
const KIND_HINT: Record<RepoKind, string> = {
  GITHUB: '대상 저장소의 Contents·Pull requests 쓰기 권한이 있는 토큰이에요.',
  GITLAB: 'api·write_repository 범위의 토큰이에요.',
};

/** 대화상자가 열린 이유 — 행에서 열면 호스트가 정해져 있고(row), 「다른 호스트 추가」는 호스트를 직접 적는다(null). */
type DialogTarget = { row: RepoConnectionRow } | { row: null };

export function AgentRepoConnectionGroup({ agentUserId }: { agentUserId: number }) {
  const projects = useAgentRuntimeProjects(agentUserId);
  const credentials = useAgentRepoCredentials(agentUserId);
  const revoke = useRevokeAgentRepoCredential(agentUserId);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<RepoConnectionRow | null>(null);

  const loading = projects.isLoading || credentials.isLoading;
  const rows = repoConnectionRows(projects.data ?? [], credentials.data ?? []);

  return (
    <div className="space-y-3" data-testid="agent-repo-group-body">
      {loading ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">연결할 저장소가 아직 없어요. 맡는 프로젝트에 저장소를 연결하거나 호스트를 직접 추가해 주세요.</p>
      ) : (
        <ul className="max-w-2xl divide-y rounded-md border">
          {rows.map((row) => (
            <RepoRow key={row.host} row={row} onConnect={() => setDialog({ row })} onRevoke={() => setRevokeTarget(row)} revoking={revoke.isPending} />
          ))}
        </ul>
      )}
      <Button size="sm" variant="ghost" onClick={() => setDialog({ row: null })} data-testid="agent-repo-add">
        + 다른 호스트 추가
      </Button>

      {dialog && (
        // 열릴 때마다 새로 그려 입력(호스트·토큰)이 이전 값을 끌고 오지 않게 한다.
        <RepoDialog agentUserId={agentUserId} row={dialog.row} onClose={() => setDialog(null)} />
      )}

      <AlertDialog open={revokeTarget != null} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogContent data-testid="agent-repo-revoke-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{revokeTarget?.host} 연결을 끊을까요?</AlertDialogTitle>
            <AlertDialogDescription>연결을 끊으면 이 AI 는 {revokeTarget?.host} 저장소의 코드를 받거나 PR 을 올릴 수 없어요. 실행 중이면 다음에 다시 시작할 때부터 적용돼요.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const id = revokeTarget?.credential?.id;
                setRevokeTarget(null);
                if (id != null) revoke.mutate(id);
              }}
              data-testid="agent-repo-revoke-confirm"
            >
              연결 끊기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** 호스트 한 줄 — 종류 배지·호스트·(필요한 호스트면) 프로젝트 줄·등록 정보와 단추. */
function RepoRow({ row, onConnect, onRevoke, revoking }: { row: RepoConnectionRow; onConnect: () => void; onRevoke: () => void; revoking: boolean }) {
  const { host, kind, projectKeys, credential } = row;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5" data-testid={`agent-repo-row-${host}`}>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          <Badge variant="secondary">{KIND_LABEL[kind]}</Badge>
          <span className="font-mono">{host}</span>
          {!credential && (
            <span className="inline-flex items-center gap-1 text-xs text-warning">
              <X className="size-3.5" aria-hidden />
              연결 안 됨
            </span>
          )}
        </div>
        {projectKeys.length > 0 && <p className="text-xs text-muted-foreground">{projectKeys.join(' · ')} 프로젝트 저장소</p>}
        {credential && (
          <p className="text-xs text-muted-foreground">
            등록 {formatMonthDayClock(credential.createdAt)} · 최근 사용 {credential.lastUsedAt ? formatRelativeTime(credential.lastUsedAt) : '없음'}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        {credential ? (
          <>
            <Button size="sm" variant="outline" onClick={onConnect} data-testid={`agent-repo-reconnect-${host}`}>
              다시 연결
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={revoking}
              onClick={onRevoke}
              data-testid={`agent-repo-revoke-${host}`}
            >
              연결 끊기
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={onConnect} data-testid={`agent-repo-connect-${host}`}>
            연결하기
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * 토큰 붙여넣기 대화상자 — 종류(GitHub/GitLab)·호스트·토큰. 행에서 열면 호스트가 고정(읽기 전용)이고, 추가에서 열면 호스트를 적는다.
 * 저장은 등록 겸 교체(같은 호스트가 이미 있으면 서버가 이전 토큰을 폐기). 실패 알림은 훅이 띄우고 대화상자는 열어 둔다.
 */
function RepoDialog({ agentUserId, row, onClose }: { agentUserId: number; row: RepoConnectionRow | null; onClose: () => void }) {
  const register = useRegisterAgentRepoCredential(agentUserId);
  const [kind, setKind] = useState<RepoKind>(row?.kind ?? 'GITHUB');
  // 호스트를 적는 동안 종류를 짐작해 따라가되, 사용자가 종류를 직접 골랐으면 그 선택을 존중한다.
  const [kindTouched, setKindTouched] = useState(false);
  const [hostInput, setHostInput] = useState(row?.host ?? '');
  const [token, setToken] = useState('');

  const host = row ? row.host : normalizeRepoHost(hostInput);
  const tokenText = token.trim();
  const tokenOk = tokenText.length >= TOKEN_MIN && tokenText.length <= TOKEN_MAX;
  const hostError = !row && hostInput.trim() !== '' && host == null;

  const onHostChange = (value: string) => {
    setHostInput(value);
    const next = normalizeRepoHost(value);
    if (next && !kindTouched) setKind(guessRepoKind(next));
  };

  const submit = async () => {
    if (!host || !tokenOk) return;
    try {
      await register.mutateAsync({ kind, host, token: tokenText });
      setToken('');
      toast.success(`${host} 저장소를 연결했어요`);
      onClose();
    } catch {
      // 오류 알림은 훅의 onError 가 이미 띄웠다 — 입력은 그대로 두어 다시 시도할 수 있게 한다.
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="agent-repo-dialog">
        <DialogHeader>
          <DialogTitle>{row?.credential ? `${row.host} 다시 연결` : row ? `${row.host} 연결하기` : '저장소 호스트 추가'}</DialogTitle>
          <DialogDescription>
            이 AI 가 코드를 받고 PR 을 올릴 때 쓰는 토큰이에요. 저장하면 입력한 값은 다시 표시되지 않아요.
            {row?.credential ? ' 이전 토큰은 자동으로 해제돼요.' : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>저장소 종류</Label>
            <RadioGroup
              value={kind}
              onValueChange={(v) => {
                setKind(v as RepoKind);
                setKindTouched(true);
              }}
              className="grid grid-cols-2 gap-2"
              data-testid="agent-repo-kind"
            >
              {(['GITHUB', 'GITLAB'] as const).map((k) => (
                <Label
                  key={k}
                  htmlFor={`agent-repo-kind-${k.toLowerCase()}`}
                  className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm font-normal has-[[data-state=checked]]:border-primary"
                >
                  <RadioGroupItem id={`agent-repo-kind-${k.toLowerCase()}`} value={k} data-testid={`agent-repo-kind-${k.toLowerCase()}`} />
                  {KIND_LABEL[k]}
                </Label>
              ))}
            </RadioGroup>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-repo-host">호스트</Label>
            <Input
              id="agent-repo-host"
              value={hostInput}
              onChange={(e) => onHostChange(e.target.value)}
              readOnly={row != null}
              placeholder="github.com"
              className="font-mono text-sm"
              autoComplete="off"
              spellCheck={false}
              data-testid="agent-repo-host"
            />
            {hostError && <p className="text-xs text-destructive">https:// 나 경로 없이 호스트 이름만 적어 주세요. 예: github.com</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-repo-token">토큰</Label>
            <PasswordInput
              id="agent-repo-token"
              fieldLabel="토큰"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="붙여넣기"
              className="font-mono text-sm"
              autoComplete="off"
              spellCheck={false}
              data-testid="agent-repo-token"
            />
            <p className="text-xs text-muted-foreground">{KIND_HINT[kind]}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button onClick={() => void submit()} disabled={!host || !tokenOk || register.isPending} data-testid="agent-repo-save">
            {register.isPending ? '저장 중…' : row?.credential ? '변경' : '연결하기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
