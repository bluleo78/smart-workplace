// ADMIN — AGENT 유저 + API 키 관리 페이지.
// 목록은 테이블, 상세(공통 비서 지정 + 인증)는 우측 Drawer(Sheet)로 표시한다.
// 키 발급 응답에 포함된 plaintextKey 는 즉시 dialog 로 표시 (1회).

import { ChevronDown } from 'lucide-react';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
import { copyText } from '@/lib/copyText';
import { formatDateOnly } from '@/lib/formatters';
import { parseId } from '@/lib/historyParam';
import {
  buildLaunchAsCommand,
  buildPluginInstallCommands,
  buildSwitchCommand,
  buildTokenFallbackCommand,
  buildWorkLoopLaunchCommand,
  buildWorkLoopStartCommand,
  PLUGIN_COMMANDS,
  PLUGIN_SKILLS,
} from '@/lib/pluginGuide';
import { objectParticle } from '@/lib/utils';

import { AgentBadge } from '../../components/users/AgentBadge';
import { useRevokeAgentKey } from '../../hooks/queries/useAgentKeys';
import { useAgents, useDeleteAgent } from '../../hooks/queries/useAgents';
import { useWorkspaceAssistant } from '../../hooks/queries/useAssistant';
import { useHistoryParam } from '../../hooks/useHistoryParam';
import {
  externalKeyStatusText,
  runtimeBadgeLabel,
} from '../../lib/agentRuntime';
import { clickableRowProps } from '../../lib/clickableRowProps';
import type { AgentResponse } from '../../types/agent';
import { AgentConnectionSection } from './components/AgentConnectionSection';
import { AgentIdentitySection } from './components/AgentIdentitySection';
import { AgentKeyIssueDialog } from './components/AgentKeyIssueDialog';
import { AgentKeysSection } from './components/AgentKeysSection';
import { AgentRuntimeSection } from './components/AgentRuntimeSection';
import { CopyableCommand } from './components/CopyableCommand';
import { NewAgentDialog } from './components/NewAgentDialog';
import { PluginServerUrlStep } from './components/PluginServerUrlStep';

// AI 아이디 복사 — 플러그인 로그인 화면의 "이름" 칸에 그대로 붙여 넣게 한다. 실패 시 직접 복사하도록 알린다.
async function copyUsername(username: string) {
  if (await copyText(username)) toast.success('아이디를 복사했습니다');
  else toast.error('복사에 실패했습니다. 아이디를 직접 선택해 복사하세요.');
}

export default function AgentManagementPage() {
  // 개인 비서(자동 생성 AGENT) 포함 여부 토글. 기본 표시 — 토글로 숨김 가능.
  const [includePersonal, setIncludePersonal] = useState(true);
  const agents = useAgents(includePersonal);
  const deleteAgent = useDeleteAgent();
  // 공통 비서 상태 — 테이블 배지 + 빈 상태 배너에 사용.
  const ws = useWorkspaceAssistant();
  // 열린 에이전트 = URL ?agent(상세 시트 열림의 단일 원천, WP-209). 행 클릭은 push → 시스템 뒤로가기가 시트만 닫는다.
  const agentParam = useHistoryParam('agent');
  const selectedId = parseId(agentParam.value);
  // selectedId 가 null 인 경우 0 으로 두지만, mutate 는 키 행이 있을 때(선택됨)만 호출된다.
  const revoke = useRevokeAgentKey(selectedId ?? 0);
  const [showNew, setShowNew] = useState(false);
  const [plaintext, setPlaintext] = useState<string | null>(null);

  // 파괴적 작업 확인 AlertDialog — API 키 회수 + AGENT 삭제. window.confirm 대체 (#136).
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description: string;
    actionLabel: string;
    action: () => void;
  } | null>(null);

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
      // 남은 기록이 있으면 서버가 삭제 대신 사용을 중지한다(WP-705) — 확인 단계에서 미리 알린다.
      description: `에이전트 "${name}"${objectParticle(name)} 삭제하시겠습니까? 키도 모두 제거됩니다. 이 AI 가 남긴 기록이 있으면 기록은 두고 사용을 중지합니다.`,
      actionLabel: '삭제',
      action: () =>
        deleteAgent.mutate(id, {
          onSuccess: () => {
            if (selectedId === id) agentParam.close();
          },
        }),
    });
  };

  const selected = agents.data?.find((a) => a.id === selectedId) ?? null;
  const external = selected?.runtime === 'EXTERNAL';
  // 키 발급 폼 + 키 목록 — 내부(API 키 블록)·외부(① 키 발급) 두 레이아웃이 공유한다. key 로 행 전환 시 label 입력 리셋.
  const keysSection =
    selected != null ? (
      <AgentKeysSection
        key={selected.id}
        agentId={selected.id}
        external={external}
        onIssued={setPlaintext}
        onRevoke={onRevoke}
      />
    ) : null;
  const isEmpty =
    !agents.isLoading && !agents.isError && (agents.data ?? []).length === 0;

  return (
    <SettingsPage
      title="에이전트"
      actions={
        /* 헤더 주 액션 — size 미지정(default). 04-components §E 규정(#744/#747). */
        <Button onClick={() => setShowNew(true)} data-testid="new-agent-trigger">
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
              {/* 좁은 화면은 나머지 열을 숨기고 이름 아래 한 줄로 모은다 — 표가 휴대폰 폭을 넘었다(WP-639) */}
              <TableHead className="hidden md:table-cell">아이디</TableHead>
              <TableHead className="hidden md:table-cell">유형</TableHead>
              <TableHead className="hidden md:table-cell">실행</TableHead>
              <TableHead className="hidden md:table-cell">생성일</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  로딩 중…
                </TableCell>
              </TableRow>
            ) : agents.isError ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-destructive">
                  목록을 불러오지 못했습니다
                </TableCell>
              </TableRow>
            ) : isEmpty ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  에이전트가 없습니다
                </TableCell>
              </TableRow>
            ) : (
              (agents.data ?? []).map((a) => (
                <TableRow
                  key={a.id}
                  className="cursor-pointer focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid={`agent-row-${a.id}`}
                  {...clickableRowProps(() => agentParam.open(String(a.id)), `${a.name} 상세 보기`)}
                >
                  <TableCell>
                    <div className="flex items-start gap-2.5 md:items-center">
                      {/* 아바타 — 이름 첫 글자. AGENT 정체성 색(ai-accent). 모바일은 이름 아래 줄이 붙어 위쪽 정렬. */}
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ai-accent-subtle text-xs font-semibold text-ai-accent"
                        aria-hidden
                      >
                        {a.name.slice(0, 1)}
                      </span>
                      <div className="min-w-0">
                        {/* 모바일은 긴 이름을 줄바꿈해 칸 안에 둔다(데스크톱은 그대로 한 줄) */}
                        <span className="font-medium break-words whitespace-normal md:whitespace-nowrap">{a.name}</span>
                        {/* 모바일 전용 — 숨긴 아이디·유형·실행 열의 값(WP-639) */}
                        <div
                          className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground md:hidden"
                          data-testid={`agent-meta-${a.id}`}
                        >
                          <span className="max-w-[60vw] truncate">{a.username}</span>
                          <AgentTypeBadge agent={a} />
                          <Badge variant={a.runtime === 'EXTERNAL' ? 'info' : 'secondary'}>
                            {runtimeBadgeLabel(a.runtime)}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {a.username}
                  </TableCell>
                  <TableCell className="hidden md:table-cell" data-testid={`agent-type-${a.id}`}>
                    <AgentTypeBadge agent={a} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell" data-testid={`agent-runtime-cell-${a.id}`}>
                    {/* 실행 방식 배지 — 외부는 info 토큰. 외부는 키 사용 시각을 함께 보여 연결 여부를 가늠하게 한다. */}
                    <div className="flex flex-col items-start gap-0.5">
                      <Badge variant={a.runtime === 'EXTERNAL' ? 'info' : 'secondary'}>
                        {runtimeBadgeLabel(a.runtime)}
                      </Badge>
                      {a.runtime === 'EXTERNAL' && (
                        <span
                          className="text-xs text-muted-foreground"
                          data-testid={`agent-key-status-${a.id}`}
                        >
                          {externalKeyStatusText(a.lastKeyUsedAt)}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {formatDateOnly(a.createdAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 상세 Drawer — 행 클릭 시 우측에서 슬라이드. 열림 = ?agent 존재(없는 id 면 찾을 수 없음 안내, WP-209). */}
      <Sheet
        open={agentParam.value != null}
        onOpenChange={(open) => {
          if (!open) agentParam.close();
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

                {/* 실행 방식 — 내부(서버 실행)/외부(사용자 컴퓨터 등) 선택. */}
                <AgentRuntimeSection key={`rt-${selected.id}`} agent={selected} />

                {external ? (
                  /* 외부 에이전트 연결 — AI 연결·모델은 숨기고 키 발급 + MCP 연결 안내만 보인다. */
                  <section className="space-y-3 rounded-md border p-4" data-testid="external-connect-card">
                    <h3 className="text-sm font-medium">외부 에이전트 연결</h3>
                    <div className="space-y-2">
                      <h4 className="text-xs font-medium text-muted-foreground">① 키 발급</h4>
                      {keysSection}
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-xs font-medium text-muted-foreground">
                        ② genia-works 플러그인 설치 (한 번만 · 설치했으면 건너뛰기)
                      </h4>
                      <CopyableCommand command={buildPluginInstallCommands()} testId="plugin-install-command" />
                      <PluginServerUrlStep />
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-xs font-medium text-muted-foreground">
                        ③ Claude Code 에 이 AI 등록 (컴퓨터마다 한 번)
                      </h4>
                      <CopyableCommand command={PLUGIN_COMMANDS.login} testId="agent-login-command" />
                      <p className="text-xs text-muted-foreground">
                        「새 AI 추가」를 고르고 ①에서 발급한 키를 붙여 넣으세요. 이름은 이 AI 의 아이디{' '}
                        <code className="font-mono">{selected.username}</code> 로 넣으면 아래 명령을 그대로 쓸 수 있어요.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="agent-username-copy"
                        onClick={() => void copyUsername(selected.username)}
                      >
                        아이디 복사
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-xs font-medium text-muted-foreground">④ 이 AI로 일하기</h4>
                      <p className="text-xs text-muted-foreground">지금 세션에서 바꾸기</p>
                      <CopyableCommand command={buildSwitchCommand(selected.username)} testId="agent-switch-command" />
                      <p className="text-xs text-muted-foreground">처음부터 이 AI로 띄우기</p>
                      <CopyableCommand command={buildLaunchAsCommand(selected.username)} testId="agent-launch-as-command" />
                      <p className="text-xs text-muted-foreground">
                        그 세션만 이 AI로 바뀌고, 다른 세션은 내 계정 그대로예요.{' '}
                        <code className="font-mono">{PLUGIN_COMMANDS.logout}</code> 하면 내 계정으로 돌아옵니다.
                      </p>
                    </div>
                    <div className="space-y-2" data-testid="agent-work-loop">
                      <h4 className="text-xs font-medium text-muted-foreground">⑤ 자동으로 이슈 처리</h4>
                      <p className="text-xs text-muted-foreground">이 AI 전용 터미널에서 띄우기</p>
                      <CopyableCommand
                        command={buildWorkLoopLaunchCommand(selected.username)}
                        testId="agent-work-loop-launch-command"
                      />
                      <p className="text-xs text-muted-foreground">Claude Code 안에서 시작하기</p>
                      <CopyableCommand command={buildWorkLoopStartCommand()} testId="agent-work-loop-start-command" />
                      <p className="text-xs text-muted-foreground">
                        이 AI 에게 할당된 이슈를 하나씩 가져와 구현·검증·main 머지까지 하고 검토 대기로 올립니다. push·배포는
                        하지 않아요.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        권한을 묻지 않는 모드라 이 AI 전용 터미널에서만 쓰세요. Claude Code 가 열려 있는 동안만 돌고 7일 뒤
                        다시 켜야 해요.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        이슈 하나만 맡길 때는 <code className="font-mono">{PLUGIN_SKILLS.workOn} 이슈키</code> 를 쓰세요.
                      </p>
                    </div>
                    {/* 플러그인 전환을 못 쓰는 환경용 — 기본은 접어 둔다. */}
                    <Collapsible className="border-t pt-3">
                      <CollapsibleTrigger
                        className="group flex w-full items-center justify-between text-left text-xs font-medium text-muted-foreground hover:text-foreground"
                        data-testid="agent-fallback"
                      >
                        다른 방법 (Windows 등 플러그인 전환을 쓸 수 없을 때)
                        <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-2 pt-2">
                        <CopyableCommand command={buildTokenFallbackCommand()} testId="agent-fallback-command" />
                        <p className="text-xs text-muted-foreground">
                          키를 직접 넘겨 띄웁니다. 셸 기록에 키가 남을 수 있어요.
                        </p>
                      </CollapsibleContent>
                    </Collapsible>
                  </section>
                ) : (
                  <>
                    {/* AI 연결 및 모델 — 연결 상태/재발급/회수 + 공통 비서 지정 + 모델/생각의 깊이. */}
                    <AgentConnectionSection agentUserId={selected.id} />

                    {/* 인증 — API 키. */}
                    {keysSection}
                  </>
                )}
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
          ) : agents.isLoading ? (
            <SheetHeader className="shrink-0 space-y-0 border-b px-6 py-4">
              <SheetTitle>불러오는 중…</SheetTitle>
              <SheetDescription className="sr-only">에이전트 상세</SheetDescription>
            </SheetHeader>
          ) : (
            // 삭제됐거나 개인 비서 숨김 필터로 목록에서 빠진 id — URL 을 조용히 고치지 않고 닫기로 되돌린다.
            <SheetHeader data-testid="agent-detail-notfound" className="shrink-0 space-y-0 border-b px-6 py-4">
              <SheetTitle>에이전트를 찾을 수 없습니다</SheetTitle>
              <SheetDescription>삭제되었거나 목록 필터로 숨겨진 에이전트입니다.</SheetDescription>
            </SheetHeader>
          )}
        </SheetContent>
      </Sheet>

      <NewAgentDialog open={showNew} onOpenChange={setShowNew} />
      <AgentKeyIssueDialog
        plaintextKey={plaintext}
        username={external ? selected?.username ?? null : null}
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

/** 에이전트 유형 배지 — 표의 유형 열과 모바일 이름 아래 줄이 같이 쓴다. */
function AgentTypeBadge({ agent }: { agent: AgentResponse }) {
  if (agent.type === 'WORKSPACE') {
    // 공통 비서 = 이 페이지의 초점이므로 채워진 primary 배지로 강조.
    return <Badge variant="default">공통</Badge>;
  }
  if (agent.type === 'PERSONAL') {
    // 개인 비서 = secondary 배지 + 소유자 이름(누구의 비서인지). 줄바꿈 방지.
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <Badge variant="secondary">개인</Badge>
        <span className="text-xs text-muted-foreground">{agent.ownerName ?? '소유자 미상'}</span>
      </span>
    );
  }
  // 일반 에이전트 = 가장 낮은 강조의 outline 배지.
  return <Badge variant="outline">일반</Badge>;
}
