// 에이전트 상세의 「기본 정보」·「역할 할당」·「맡은 일과 지시」·「코드 저장소」·「위험 구역」 섹션(WP-1281).
// 예전 시트의 AgentAvatarSection·AgentIdentitySection·AgentAccessSections(역할)·맡는 프로젝트·삭제 단추를 설정 섹션(SettingsSection) 모양으로 옮겼다.
// 개인 비서(PERSONAL)는 주인 전용이라(WP-1163) 기본 정보·맡은 일은 보기만, 역할·위험 구역은 그리지 않는다(부모가 판정).

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { settingsFieldClass, SettingsSection } from '@/components/layout/SettingsSection';
import { AGENT_DETAIL_SECTION_IDS } from '@/components/settings-guide/sectionIds';
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
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { AvatarEditor } from '@/components/users/AvatarEditor';
import { AvatarPicture } from '@/components/users/AvatarPicture';
import { useAvatarUrl } from '@/hooks/avatar-map-context';
import { useAfterAvatarChange } from '@/hooks/queries/useAvatars';

import { deleteAgentAvatar, uploadAgentAvatar } from '../../../../api/agents';
import { rolesApi } from '../../../../api/roles';
import { usersApi } from '../../../../api/users';
import { useAgentRuntimeProjects } from '../../../../hooks/queries/useAgentRuntime';
import { agentKeys, useDeleteAgent, useRenameAgent } from '../../../../hooks/queries/useAgents';
import { cn, objectParticle } from '../../../../lib/utils';
import type { AgentResponse } from '../../../../types/agent';
import { UserRolesSection } from '../UserAccessSections';

// 설명(맡은 일)·지시 최대 길이 — 서버 RenameAgentRequest 의 @Size 와 같다.
const AGENT_DESCRIPTION_MAX = 500;
const AGENT_INSTRUCTIONS_MAX = 4000;

/** 개인 비서 안내 — 관리자는 보기만 한다. */
const OWNER_MANAGED = '이 AI 는 주인이 관리해요.';

/**
 * 기본 정보 — 아바타·이름·아이디. 목록과 담당자 고르기에 보이는 모습이다.
 * 이름 변경 API 는 맡은 일·지시도 함께 받으므로(빼면 그대로 둠) 여기서는 저장된 맡은 일을 그대로 실어 보낸다.
 */
export function AgentBasicInfoSection({ agent }: { agent: AgentResponse }) {
  const rename = useRenameAgent();
  const avatarUrl = useAvatarUrl(agent.id);
  const refreshAvatars = useAfterAvatarChange();
  const [name, setName] = useState(agent.name);
  const [username, setUsername] = useState(agent.username);
  const personal = agent.type === 'PERSONAL';
  const dirty = name.trim() !== agent.name || username.trim() !== agent.username;
  const valid = name.trim() !== '' && username.trim() !== '';

  return (
    <SettingsSection
      id={AGENT_DETAIL_SECTION_IDS.profile}
      title="기본 정보"
      description={personal ? OWNER_MANAGED : '목록과 담당자 고르기에 보이는 모습이에요.'}
      data-testid="agent-basic-section"
    >
      {personal ? (
        // 개인 비서 — 보기만(이름·아이디 편집과 아바타 바꾸기는 주인 전용).
        <div className="flex items-center gap-3">
          <span className="relative flex size-11 shrink-0 items-center justify-center rounded-lg bg-ai-accent-subtle text-sm font-semibold text-ai-accent">
            <AvatarPicture userId={agent.id} name={agent.name} px={44} className="rounded-lg">
              {agent.name.slice(0, 1)}
            </AvatarPicture>
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-medium">{agent.name}</p>
            <p className="text-muted-foreground">{agent.username}</p>
          </div>
        </div>
      ) : (
        <>
          <AvatarEditor
            testId="agent-avatar"
            userId={agent.id}
            name={agent.name}
            avatarUrl={avatarUrl}
            upload={async (file, crop) => {
              await uploadAgentAvatar(agent.id, file, crop);
              await refreshAvatars();
            }}
            reset={async () => {
              await deleteAgentAvatar(agent.id);
              await refreshAvatars();
            }}
          />
          <div className={cn('space-y-1.5', settingsFieldClass)}>
            <Label htmlFor="agent-name-input">이름</Label>
            <Input id="agent-name-input" data-testid="agent-name-input" value={name} maxLength={50} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className={cn('space-y-1.5', settingsFieldClass)}>
            <Label htmlFor="agent-username-input">아이디</Label>
            <Input
              id="agent-username-input"
              data-testid="agent-username-input"
              value={username}
              maxLength={50}
              aria-describedby="agent-username-help"
              onChange={(e) => setUsername(e.target.value)}
            />
            {/* 칸 바로 옆에서 알아야 하는 주의라 가이드로 옮기지 않는다. */}
            <p id="agent-username-help" className="text-xs text-muted-foreground">
              @멘션과 이 AI 를 띄운 도구의 접속에 쓰여요. 바꾸면 예전 아이디로 한 멘션은 이 AI 에게 가지 않아요.
            </p>
          </div>
          <Button
            disabled={!dirty || !valid || rename.isPending}
            data-testid="agent-identity-save"
            onClick={() =>
              rename.mutate({ userId: agent.id, username: username.trim(), name: name.trim(), description: agent.description ?? '' })
            }
          >
            저장
          </Button>
        </>
      )}
    </SettingsSection>
  );
}

// 역할 목록은 역할 화면이 react-query 를 쓰지 않아 무효화할 길이 없으니 상세를 열 때마다 다시 읽는다(staleTime 0).
const roleKeys = {
  user: (id: number) => [...agentKeys.all, 'access', id] as const,
  roles: ['agent-access', 'roles'] as const,
};

/** 역할 할당 — 구성원 상세와 같은 섹션(UserRolesSection)을 쓴다. 에이전트 응답에 역할이 없어 계정 상세(/users/:id)를 따로 읽는다. */
export function AgentRolesSection({ agent }: { agent: AgentResponse }) {
  const qc = useQueryClient();
  const user = useQuery({ queryKey: roleKeys.user(agent.id), queryFn: () => usersApi.getUserById(agent.id).then((r) => r.data) });
  const roles = useQuery({ queryKey: roleKeys.roles, queryFn: () => rolesApi.getRoles().then((r) => r.data), staleTime: 0 });
  if (user.isError || roles.isError) {
    return (
      <SettingsSection id={AGENT_DETAIL_SECTION_IDS.roles} title="역할 할당">
        <p className="text-sm text-destructive" data-testid="agent-access-error">
          역할을 불러오지 못했습니다.
        </p>
      </SettingsSection>
    );
  }
  if (!user.data || !roles.data) {
    return (
      <SettingsSection id={AGENT_DETAIL_SECTION_IDS.roles} title="역할 할당">
        <Skeleton className="h-24 w-full" />
      </SettingsSection>
    );
  }
  return (
    <UserRolesSection
      key={agent.id}
      id={AGENT_DETAIL_SECTION_IDS.roles}
      user={user.data}
      allRoles={roles.data}
      onSaved={(updated) => qc.setQueryData(roleKeys.user(agent.id), updated)}
    />
  );
}

/**
 * 맡은 일과 지시 — 맡은 일(설명, WP-455)은 다른 AI 가 일을 맡길 상대를 고를 때 읽고, 지시(WP-1077)는 이 AI 가 이슈를 맡을 때마다 따른다.
 * 기본 방식은 지시를 읽지 않아 칸을 막고 이유를 보인다(적힌 지시는 지우지 않는다 — 다른 방식으로 바꾸면 다시 따른다).
 */
export function AgentDutySection({ agent }: { agent: AgentResponse }) {
  const rename = useRenameAgent();
  const savedDescription = agent.description ?? '';
  const savedInstructions = agent.instructions ?? '';
  const [description, setDescription] = useState(savedDescription);
  const [instructions, setInstructions] = useState(savedInstructions);
  const personal = agent.type === 'PERSONAL';
  // 기본 방식(서버가 바로 답함)은 지시를 읽지 않는다 — 저장할 때도 지시는 보내지 않아 그대로 둔다.
  const instructionsOff = agent.runMode === 'SERVER';
  const dirty = description.trim() !== savedDescription || (!instructionsOff && instructions.trim() !== savedInstructions);

  return (
    <SettingsSection
      id={AGENT_DETAIL_SECTION_IDS.work}
      title="맡은 일과 지시"
      description={personal ? OWNER_MANAGED : '이 AI 가 무엇을 맡는지, 일할 때 무엇을 따르는지예요.'}
      data-testid="agent-duty-section"
    >
      <div className="space-y-1.5">
        <Label htmlFor="agent-description-input">맡은 일</Label>
        <Textarea
          id="agent-description-input"
          data-testid="agent-description-input"
          value={description}
          maxLength={AGENT_DESCRIPTION_MAX}
          rows={3}
          disabled={personal}
          placeholder={personal ? undefined : '예: 코드 리뷰를 맡습니다. 변경 이유와 빠진 테스트를 보고 이슈 댓글로 남깁니다.'}
          onChange={(e) => setDescription(e.target.value)}
        />
        {/* 칸 설명은 설정 가이드로 옮겼다(WP-1281) — 글자 수만 남긴다. */}
        <div className="flex justify-end">
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {description.length} / {AGENT_DESCRIPTION_MAX}
          </span>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="agent-instructions-input">지시</Label>
        <Textarea
          id="agent-instructions-input"
          data-testid="agent-instructions-input"
          value={instructions}
          maxLength={AGENT_INSTRUCTIONS_MAX}
          rows={6}
          disabled={personal || instructionsOff}
          aria-describedby={instructionsOff ? 'agent-instructions-help' : undefined}
          placeholder={personal || instructionsOff ? undefined : '예:\n- 기획 이슈는 반드시 다른 서비스 사례를 조사해 근거와 링크를 붙인다.\n- 화면이 바뀌면 바뀌기 전·후 시안을 함께 올린다.'}
          onChange={(e) => setInstructions(e.target.value)}
        />
        <div className="flex items-start justify-between gap-3">
          {/* 막힌 이유만 남긴다 — 지시가 무엇인지는 설정 가이드에 있다. */}
          <p id="agent-instructions-help" className="text-xs text-muted-foreground">
            {instructionsOff ? '기본 방식은 지시를 읽지 않아요. 외부·Claude Code 로 바꾸면 따라요.' : null}
          </p>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {instructions.length} / {AGENT_INSTRUCTIONS_MAX}
          </span>
        </div>
      </div>
      {!personal && (
        <Button
          disabled={!dirty || rename.isPending}
          data-testid="agent-duty-save"
          onClick={() =>
            rename.mutate({
              userId: agent.id,
              username: agent.username,
              name: agent.name,
              // 빈 문자열이면 서버가 지운다(빼면 그대로 둔다).
              description: description.trim(),
              ...(instructionsOff ? {} : { instructions: instructions.trim() }),
            })
          }
        >
          저장
        </Button>
      )}
    </SettingsSection>
  );
}

/** 저장소 주소 → 「github.com/owner/name」(앞 프로토콜·끝 .git 을 뗀다). */
function repoLabel(url: string | null): string {
  if (!url) return '';
  return url.replace(/^[a-z]+:\/\//, '').replace(/^git@([^:]+):/, '$1/').replace(/\.git$/, '');
}

/**
 * 코드 저장소 — 이 AI 가 맡는 프로젝트(멤버이고 저장소가 연결된 곳, 고르지 않는다). Works 가 실행하는 AI·외부 AI 만.
 * 외부 AI 는 Works 가 코드를 받아 주지 않아, 도구를 띄운 컴퓨터의 GitHub 로그인이 필요하다는 것을 함께 알린다.
 */
export function AgentRepoSection({ agent }: { agent: AgentResponse }) {
  const projects = useAgentRuntimeProjects(agent.id);
  return (
    <SettingsSection id={AGENT_DETAIL_SECTION_IDS.repos} title="코드 저장소" description="이 AI 가 맡는 프로젝트예요." data-testid="agent-repo-section">
      {projects.isLoading ? (
        <Skeleton className="h-10 w-full max-w-2xl" />
      ) : projects.data && projects.data.length > 0 ? (
        <ul className="max-w-2xl space-y-1.5" data-testid="agent-runtime-projects">
          {projects.data.map((p) => (
            <li key={p.projectKey} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-muted/50 px-3 py-2 text-sm">
              <span className="rounded bg-background px-1.5 py-0.5 font-mono text-xs">{p.projectKey}</span>
              <span className="truncate">{p.name}</span>
              <span className="ml-auto truncate text-xs text-muted-foreground">
                {repoLabel(p.repositoryUrl)}
                {p.repositoryBranch ? ` (${p.repositoryBranch})` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">맡는 프로젝트가 없어요.</p>
      )}
      {/* 무엇이 나오는지·외부 AI 의 GitHub 로그인 안내는 설정 가이드로 옮겼다(WP-1281). */}
      <Link to="/projects" className="inline-block text-xs text-primary hover:underline">
        프로젝트 목록 열기
      </Link>
    </SettingsSection>
  );
}

/** 위험 구역 — 에이전트 삭제(확인 창 ④). 남은 기록이 있으면 서버가 삭제 대신 사용을 중지한다(WP-705). 지우면 목록으로 돌아간다. */
export function AgentDangerSection({ agent }: { agent: AgentResponse }) {
  const navigate = useNavigate();
  const remove = useDeleteAgent();
  const [open, setOpen] = useState(false);
  return (
    <SettingsSection id={AGENT_DETAIL_SECTION_IDS.danger} tone="danger" title="위험 구역" description="이 AI 와 접속 키를 지워요." data-testid="agent-danger-section">
      <Button
        variant="outline"
        className="text-destructive hover:text-destructive"
        disabled={remove.isPending}
        onClick={() => setOpen(true)}
        data-testid={`agent-delete-${agent.id}`}
      >
        에이전트 삭제
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent size="sm" data-testid="agent-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {agent.name}
              {objectParticle(agent.name)} 삭제할까요?
            </AlertDialogTitle>
            <AlertDialogDescription>
              실행을 멈추고 접속 키를 모두 폐기한 뒤 지워요. 이 AI 가 남긴 기록이 있으면 지우지 않고 사용 중지로 바꿔요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="agent-confirm-cancel">취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid="agent-confirm-confirm"
              onClick={() =>
                remove.mutate(agent.id, {
                  // 기록이 남아 사용 중지로 바뀐 경우엔 이 상세에 그대로 머문다(다시 사용으로 바꿀 수 있게).
                  onSuccess: (result) => {
                    if (result === 'DELETED') navigate('/settings/agents');
                  },
                })
              }
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
