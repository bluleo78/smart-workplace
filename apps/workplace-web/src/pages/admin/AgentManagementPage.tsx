// ADMIN — AGENT 유저 + API 키 관리 페이지.
// 좌측: AGENT 목록 (선택 가능). 우측: 선택된 AGENT 의 키 발급/회수.
// 키 발급 응답에 포함된 plaintextKey 는 즉시 dialog 로 표시 (1회).

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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { AgentBadge } from '../../components/users/AgentBadge';
import {
  useAgentKeys,
  useIssueAgentKey,
  useRevokeAgentKey,
} from '../../hooks/queries/useAgentKeys';
import {
  useAgentOAuthTokenMeta,
  useRevokeAgentOAuthToken,
} from '../../hooks/queries/useAgentOAuthToken';
import { useAgents, useDeleteAgent } from '../../hooks/queries/useAgents';
import { handleApiError } from '../../lib/api-error';
import { AgentKeyIssueDialog } from './components/AgentKeyIssueDialog';
import { NewAgentDialog } from './components/NewAgentDialog';
import { OAuthTokenDialog } from './components/OAuthTokenDialog';
import { WorkspaceAssistantCard } from './components/WorkspaceAssistantCard';

// 시간 표시 공통 — null/빈값 폴백.
function fmtDateTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('ko-KR');
  } catch {
    return iso;
  }
}

export default function AgentManagementPage() {
  const agents = useAgents();
  const deleteAgent = useDeleteAgent();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const keys = useAgentKeys(selectedId);
  // selectedId 가 null 인 경우 0 으로 두지만, enabled=false 이므로 호출은 안 됨.
  const issue = useIssueAgentKey(selectedId ?? 0);
  const revoke = useRevokeAgentKey(selectedId ?? 0);
  const [label, setLabel] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [plaintext, setPlaintext] = useState<string | null>(null);

  // 파괴적 작업 확인 AlertDialog — API 키 회수 + AGENT 삭제. window.confirm 대체 (#136).
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description: string;
    actionLabel: string;
    action: () => void;
  } | null>(null);

  const onIssue = async () => {
    if (selectedId == null) return;
    try {
      const res = await issue.mutateAsync({ label: label.trim() || null });
      setLabel('');
      setPlaintext(res.plaintextKey);
    } catch {
      /* 토스트는 mutation onError 가 처리 */
    }
  };

  // API 키 회수 — AlertDialog 로 확인 후 실행.
  const onRevoke = (keyId: number) => {
    setConfirmDialog({
      title: 'API 키 회수',
      description: '이 키를 회수하시겠습니까? 즉시 인증이 차단됩니다.',
      actionLabel: '회수',
      action: () => revoke.mutate(keyId),
    });
  };

  // AGENT 삭제 — AlertDialog 로 확인 후 실행.
  const onDelete = (id: number, name: string) => {
    setConfirmDialog({
      title: '에이전트 삭제',
      description: `에이전트 "${name}"를 삭제하시겠습니까? 키도 모두 제거됩니다.`,
      actionLabel: '삭제',
      action: () =>
        deleteAgent.mutate(id, {
          onSuccess: () => {
            if (selectedId === id) setSelectedId(null);
          },
        }),
    });
  };

  const selected = agents.data?.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] leading-[36px] font-semibold tracking-tight">
          에이전트 관리
        </h1>
        <Button
          size="sm"
          onClick={() => setShowNew(true)}
          data-testid="new-agent-trigger"
        >
          + 신규 에이전트
        </Button>
      </div>

      <WorkspaceAssistantCard />

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <aside className="space-y-2 border rounded-md p-2">
          {agents.isLoading ? (
            <p className="text-sm text-muted-foreground p-2">로딩 중…</p>
          ) : agents.isError ? (
            <p className="text-sm text-destructive p-2">목록을 불러오지 못했습니다</p>
          ) : (agents.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground p-2">에이전트가 없습니다</p>
          ) : (
            <ul className="space-y-1" role="list">
              {(agents.data ?? []).map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(a.id)}
                    className={`w-full text-left flex items-center gap-2 p-2 rounded transition-colors ${
                      selectedId === a.id
                        ? 'bg-accent'
                        : 'hover:bg-accent/50'
                    }`}
                    data-testid={`agent-row-${a.id}`}
                  >
                    <AgentBadge size="xs" />
                    <span className="font-medium truncate">{a.name}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      @{a.username}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="space-y-4">
          {selected == null ? (
            <p className="text-muted-foreground">왼쪽에서 에이전트를 선택하세요</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">{selected.name}</h2>
                  <AgentBadge size="xs" />
                  <span className="text-sm text-muted-foreground">
                    @{selected.username}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(selected.id, selected.name)}
                  disabled={deleteAgent.isPending}
                  data-testid={`agent-delete-${selected.id}`}
                >
                  에이전트 삭제
                </Button>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-medium">API 키</h3>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void onIssue();
                  }}
                  className="flex gap-2"
                  data-testid="key-issue-form"
                >
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="label (선택)"
                    maxLength={80}
                    aria-label="키 label"
                  />
                  <Button type="submit" disabled={issue.isPending}>
                    키 발급
                  </Button>
                </form>

                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b">
                        <th className="py-2 px-3">prefix</th>
                        <th className="px-3">label</th>
                        <th className="px-3">발급</th>
                        <th className="px-3">마지막 사용</th>
                        <th className="px-3">회수</th>
                        <th className="px-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {keys.isLoading ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="py-4 text-muted-foreground text-center"
                          >
                            로딩 중…
                          </td>
                        </tr>
                      ) : (keys.data ?? []).length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="py-4 text-muted-foreground text-center"
                          >
                            키가 없습니다
                          </td>
                        </tr>
                      ) : (
                        (keys.data ?? []).map((k) => (
                          <tr
                            key={k.id}
                            className="border-b"
                            data-testid={`key-row-${k.id}`}
                          >
                            <td className="py-2 px-3 font-mono">
                              {k.keyPrefix}…
                            </td>
                            <td className="px-3">{k.label ?? '-'}</td>
                            <td className="px-3 text-xs text-muted-foreground">
                              {fmtDateTime(k.createdAt)}
                            </td>
                            <td className="px-3 text-xs text-muted-foreground">
                              {fmtDateTime(k.lastUsedAt)}
                            </td>
                            <td className="px-3 text-xs text-muted-foreground">
                              {fmtDateTime(k.revokedAt)}
                            </td>
                            <td className="px-3">
                              {k.revokedAt == null && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onRevoke(k.id)}
                                  data-testid={`key-revoke-${k.id}`}
                                >
                                  회수
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <OAuthTokenSection agentUserId={selected.id} />
            </>
          )}
        </section>
      </div>

      <NewAgentDialog open={showNew} onOpenChange={setShowNew} />
      <AgentKeyIssueDialog
        plaintextKey={plaintext}
        open={plaintext != null}
        onOpenChange={(v) => {
          if (!v) setPlaintext(null);
        }}
      />

      {/* 파괴적 작업 확인 AlertDialog — API 키 회수 + AGENT 삭제. window.confirm 대체 (#136). */}
      <AlertDialog
        open={confirmDialog != null}
        onOpenChange={(open) => {
          if (!open) setConfirmDialog(null);
        }}
      >
        <AlertDialogContent data-testid="agent-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="agent-confirm-cancel">
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                confirmDialog?.action();
              }}
              data-testid="agent-confirm-confirm"
            >
              {confirmDialog?.actionLabel ?? '확인'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// AGENT 의 Claude CLI OAuth 토큰 섹션 — 메타 조회 + 등록/재발급/회수.
// 평문 토큰은 절대 응답에 포함되지 않으며, 회수 후에는 LLM 호출이 불가해진다.
function OAuthTokenSection({ agentUserId }: { agentUserId: number }) {
  const { data: meta, isLoading } = useAgentOAuthTokenMeta(agentUserId);
  const revoke = useRevokeAgentOAuthToken(agentUserId);
  const [dialogOpen, setDialogOpen] = useState(false);
  // OAuth 토큰 회수 확인 AlertDialog. window.confirm 대체 (#136).
  const [revokeOpen, setRevokeOpen] = useState(false);

  // 회수 확인 AlertDialog 표시 — 취소 시 아무것도 안 함.
  const onRevokeClick = () => {
    setRevokeOpen(true);
  };

  // AlertDialog 확인 시 실제 회수 실행.
  const doRevoke = async () => {
    try {
      await revoke.mutateAsync();
      toast.success('토큰을 회수했습니다.');
    } catch (e) {
      handleApiError(e, '토큰 회수에 실패했습니다');
    }
  };

  return (
    <section className="border-t pt-4 mt-4 space-y-2">
      <h3 className="text-sm font-medium">Claude CLI OAuth 토큰</h3>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">로드 중…</p>
      ) : meta ? (
        <div className="space-y-1 text-sm">
          <div>
            <span className="text-muted-foreground">레이블: </span>
            <span>{meta.label ?? '(없음)'}</span>
          </div>
          <div>
            <span className="text-muted-foreground">등록일: </span>
            <span>{fmtDateTime(meta.createdAt)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">최근 사용: </span>
            <span>{meta.lastUsedAt ? fmtDateTime(meta.lastUsedAt) : '미사용'}</span>
          </div>
          <div className="pt-2 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDialogOpen(true)}
              data-testid="oauth-token-reissue"
            >
              재발급
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={onRevokeClick}
              disabled={revoke.isPending}
              data-testid="oauth-token-revoke"
            >
              회수
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            등록된 토큰 없음. 에이전트는 LLM 호출 불가.
          </p>
          <Button
            size="sm"
            onClick={() => setDialogOpen(true)}
            data-testid="oauth-token-register"
          >
            등록
          </Button>
        </div>
      )}
      <OAuthTokenDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        agentUserId={agentUserId}
        isReissue={meta != null}
      />

      {/* OAuth 토큰 회수 확인 AlertDialog. window.confirm 대체 (#136). */}
      <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <AlertDialogContent data-testid="oauth-revoke-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>OAuth 토큰 회수</AlertDialogTitle>
            <AlertDialogDescription>
              OAuth 토큰을 회수하시겠습니까? 에이전트는 LLM 호출 불가 상태가 됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="oauth-revoke-cancel">
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void doRevoke()}
              data-testid="oauth-revoke-confirm"
            >
              회수
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
