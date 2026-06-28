// ADMIN — AGENT 유저 + API 키 관리 페이지.
// 목록은 테이블, 상세(공통 비서 지정 + 인증)는 우측 Drawer(Sheet)로 표시한다.
// 키 발급 응답에 포함된 plaintextKey 는 즉시 dialog 로 표시 (1회).

import { useState } from 'react';
import { toast } from 'sonner';

import { SettingsPage } from '@/components/layout/SettingsPage';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

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
import { useWorkspaceAssistant } from '../../hooks/queries/useAssistant';
import { handleApiError } from '../../lib/api-error';
import { AgentIdentitySection } from './components/AgentIdentitySection';
import { AgentKeyIssueDialog } from './components/AgentKeyIssueDialog';
import { NewAgentDialog } from './components/NewAgentDialog';
import { OAuthTokenDialog } from './components/OAuthTokenDialog';
import { WorkspaceAssistantSection } from './components/WorkspaceAssistantSection';

// 시간 표시 공통 — null/빈값 폴백.
function fmtDateTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('ko-KR');
  } catch {
    return iso;
  }
}

// 날짜만 간단 표기(테이블 셀용).
function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('ko-KR');
  } catch {
    return iso;
  }
}

export default function AgentManagementPage() {
  // 개인 비서(자동 생성 AGENT) 포함 여부 토글. 기본 숨김 — 워크스페이스 에이전트만 노출.
  const [includePersonal, setIncludePersonal] = useState(false);
  const agents = useAgents(includePersonal);
  const deleteAgent = useDeleteAgent();
  // 공통 비서 상태 — 테이블 배지 + 빈 상태 배너에 사용.
  const ws = useWorkspaceAssistant();
  // 선택된 에이전트 = Drawer 열림 상태.
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

  // AGENT 삭제 — AlertDialog 로 확인 후 실행. 삭제되면 Drawer 닫는다.
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
  const isEmpty =
    !agents.isLoading && !agents.isError && (agents.data ?? []).length === 0;

  return (
    <SettingsPage
      title="에이전트"
      actions={
        <Button
          size="sm"
          onClick={() => setShowNew(true)}
          data-testid="new-agent-trigger"
        >
          + 새 에이전트
        </Button>
      }
    >
      {/* 진입 시 안내 배너 — 두 상태를 구분한다.
          ① 에이전트가 하나도 없으면 먼저 추가하도록 안내(지정할 대상이 없음).
          ② 에이전트는 있으나 공통 비서가 미지정이면 지정하도록 안내. */}
      {isEmpty ? (
        <div
          data-testid="agent-roster-empty"
          className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground"
        >
          아직 에이전트가 없어요 — 위 ‘+ 새 에이전트’로 에이전트를 추가한 뒤 공통 비서로
          지정하세요. 공통 비서가 없으면 개인 비서를 지정하지 않은 구성원은 AI를 쓸 수 없습니다.
        </div>
      ) : ws.data && ws.data.agentUserId == null ? (
        <div
          data-testid="workspace-assistant-empty"
          className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground"
        >
          아직 공통 비서가 없어요 — 개인 비서를 지정하지 않은 구성원은 AI를 쓸 수 없습니다.
          아래 표에서 토큰이 등록된 에이전트를 골라 공통 비서로 지정하세요.
        </div>
      ) : null}

      {/* 개인 비서 포함 토글 — 기본 숨김. 켜면 자동 생성된 개인 비서까지 목록에 표시. */}
      <div className="flex items-center justify-end gap-2">
        <Switch
          id="include-personal"
          checked={includePersonal}
          onCheckedChange={setIncludePersonal}
          data-testid="include-personal-toggle"
        />
        <Label htmlFor="include-personal" className="text-sm text-muted-foreground">
          개인 비서 표시
        </Label>
      </div>

      {/* 에이전트 목록 — 테이블. 행 클릭 시 우측 Drawer 로 상세를 연다. */}
      <div className="rounded-md border">
        <Table aria-label="에이전트 목록">
          <TableHeader>
            <TableRow>
              <TableHead>에이전트</TableHead>
              <TableHead>아이디</TableHead>
              <TableHead>유형</TableHead>
              <TableHead>생성일</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  로딩 중…
                </TableCell>
              </TableRow>
            ) : agents.isError ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-destructive">
                  목록을 불러오지 못했습니다
                </TableCell>
              </TableRow>
            ) : isEmpty ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  에이전트가 없습니다
                </TableCell>
              </TableRow>
            ) : (
              (agents.data ?? []).map((a) => (
                <TableRow
                  key={a.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedId(a.id)}
                  data-testid={`agent-row-${a.id}`}
                >
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      {/* 아바타 — 이름 첫 글자. AGENT 정체성 색(ai-accent). */}
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ai-accent-subtle text-xs font-semibold text-ai-accent"
                        aria-hidden
                      >
                        {a.name.slice(0, 1)}
                      </span>
                      <span className="font-medium">{a.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.username}
                  </TableCell>
                  <TableCell data-testid={`agent-type-${a.id}`}>
                    {a.type === 'WORKSPACE' ? (
                      // 공통 비서 = 이 페이지의 초점이므로 채워진 primary 배지로 강조.
                      <Badge variant="default">공통</Badge>
                    ) : a.type === 'PERSONAL' ? (
                      // 개인 비서 = secondary 배지 + 소유자 이름(누구의 비서인지). 줄바꿈 방지.
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <Badge variant="secondary">개인</Badge>
                        <span className="text-xs text-muted-foreground">
                          {a.ownerName ?? '소유자 미상'}
                        </span>
                      </span>
                    ) : (
                      // 일반 에이전트 = 가장 낮은 강조의 outline 배지.
                      <Badge variant="outline">일반</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {fmtDate(a.createdAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 상세 Drawer — 행 클릭 시 우측에서 슬라이드. */}
      <Sheet
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl"
          data-testid="agent-detail-drawer"
        >
          {selected != null ? (
            <>
              <SheetHeader className="shrink-0 space-y-0 border-b px-6 py-4">
                <SheetTitle className="flex items-center gap-2">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ai-accent-subtle text-xs font-semibold text-ai-accent"
                    aria-hidden
                  >
                    {selected.name.slice(0, 1)}
                  </span>
                  {selected.name}
                  <AgentBadge size="xs" />
                </SheetTitle>
                <SheetDescription>{selected.username}</SheetDescription>
              </SheetHeader>

              <div className="flex-1 space-y-4 px-6 py-4">
                {/* 에이전트 정보(이름/아이디) 편집 — 개인 비서는 컴포넌트 내부에서 숨김. key 로 행 전환 시 입력 리셋. */}
                <AgentIdentitySection key={selected.id} agent={selected} />

                {/* 공통 비서 섹션. */}
                <WorkspaceAssistantSection agentUserId={selected.id} />

                {/* 인증 — API 키. */}
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
                            <td colSpan={6} className="py-4 text-muted-foreground text-center">
                              로딩 중…
                            </td>
                          </tr>
                        ) : (keys.data ?? []).length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-4 text-muted-foreground text-center">
                              키가 없습니다
                            </td>
                          </tr>
                        ) : (
                          (keys.data ?? []).map((k) => (
                            <tr key={k.id} className="border-b" data-testid={`key-row-${k.id}`}>
                              <td className="py-2 px-3 font-mono">{k.keyPrefix}…</td>
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

                {/* 인증 — OAuth 토큰. */}
                <OAuthTokenSection agentUserId={selected.id} />
              </div>

              {/* 위험 영역 — 에이전트 삭제. */}
              <div className="shrink-0 border-t px-6 py-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onDelete(selected.id, selected.name)}
                  disabled={deleteAgent.isPending}
                  data-testid={`agent-delete-${selected.id}`}
                >
                  에이전트 삭제
                </Button>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

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
    </SettingsPage>
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
