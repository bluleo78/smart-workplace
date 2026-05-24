// ADMIN — AGENT 유저 + API 키 관리 페이지.
// 좌측: AGENT 목록 (선택 가능). 우측: 선택된 AGENT 의 키 발급/회수.
// 키 발급 응답에 포함된 plaintextKey 는 즉시 dialog 로 표시 (1회).

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { AgentBadge } from '../../components/users/AgentBadge';
import { useAgents, useDeleteAgent } from '../../hooks/queries/useAgents';
import {
  useAgentKeys,
  useIssueAgentKey,
  useRevokeAgentKey,
} from '../../hooks/queries/useAgentKeys';

import { AgentKeyIssueDialog } from './components/AgentKeyIssueDialog';
import { NewAgentDialog } from './components/NewAgentDialog';

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

  const onRevoke = (keyId: number) => {
    if (!confirm('이 키를 회수하시겠습니까? 즉시 인증이 차단됩니다.')) return;
    revoke.mutate(keyId);
  };

  const onDelete = (id: number, name: string) => {
    if (!confirm(`AGENT "${name}" 를 삭제하시겠습니까? 키도 모두 제거됩니다.`)) return;
    deleteAgent.mutate(id, {
      onSuccess: () => {
        if (selectedId === id) setSelectedId(null);
      },
    });
  };

  const selected = agents.data?.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] leading-[36px] font-semibold tracking-tight">
          AGENT 관리
        </h1>
        <Button
          size="sm"
          onClick={() => setShowNew(true)}
          data-testid="new-agent-trigger"
        >
          + 신규 AGENT
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <aside className="space-y-2 border rounded-md p-2">
          {agents.isLoading ? (
            <p className="text-sm text-muted-foreground p-2">로딩 중…</p>
          ) : agents.isError ? (
            <p className="text-sm text-destructive p-2">목록을 불러오지 못했습니다</p>
          ) : (agents.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground p-2">AGENT 가 없습니다</p>
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
            <p className="text-muted-foreground">왼쪽에서 AGENT 를 선택하세요</p>
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
                  AGENT 삭제
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
    </div>
  );
}
