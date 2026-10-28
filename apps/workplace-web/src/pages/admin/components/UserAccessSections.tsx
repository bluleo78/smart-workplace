// 계정의 「활성 상태」·「역할 할당」 섹션 — 구성원 상세(사람)와 에이전트 상세(공통 비서·일반 AI)가 함께 쓴다(WP-1075).
// API 는 대상 종류와 관계없이 /users/:id/active·/users/:id/roles 다. 자기 자신·마지막 관리자 가드는 화면(내 계정 잠금·내 ADMIN 체크 잠금)과
// 서버(409 사유 토스트)가 나눠 맡는다.

import { useState } from 'react';
import { toast } from 'sonner';

import { usersApi } from '../../../api/users';
import { SettingsSection, SettingsToggleRow } from '../../../components/layout/SettingsSection';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { Label } from '../../../components/ui/label';
import { Switch } from '../../../components/ui/switch';
import { useAuth } from '../../../hooks/useAuth';
import { handleApiError } from '../../../lib/api-error';
import { assignableRoles } from '../../../lib/assignableRoles';
import type { RoleResponse } from '../../../types/role';
import type { UserDetailResponse } from '../../../types/user';

type AccessUser = Pick<UserDetailResponse, 'id' | 'kind' | 'isActive' | 'roles'>;

/**
 * 활성 상태 — 토글 행(라벨 왼쪽·스위치 오른쪽 끝). 끄기(활성→비활성)는 확인 대화상자를 거치고, 켜기는 바로 저장한다(#50).
 * WP-417: 비활성은 이 워크스페이스 멤버십 정지라 문구도 워크스페이스 범위로 쓴다. AI 는 같은 정지를 「일할 수 없음」으로 안내한다.
 * onChanged 는 저장에 성공한 새 값을 알린다 — 부모가 화면 값·목록을 갱신한다.
 */
export function UserActiveSection({
  user,
  onChanged,
  lockedReason,
}: {
  user: AccessUser;
  onChanged: (active: boolean) => void;
  /** 끌 수 없는 이유 — 있으면 활성인 스위치를 막고 이유를 보인다(예: 공통 비서는 지정 해제가 먼저, WP-1075). 서버도 409 로 막는다. */
  lockedReason?: string;
}) {
  const { user: currentUser } = useAuth();
  const [isToggling, setIsToggling] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const isAgent = user.kind === 'AGENT';
  // WP-909: 내 활성 계정은 끌 수 없으니 스위치를 처음부터 막고 이유를 보인다.
  const isSelfActive = currentUser?.id === user.id && user.isActive;
  const offLockReason = isSelfActive
    ? '내 계정은 비활성화할 수 없어요.'
    : user.isActive
      ? lockedReason
      : undefined;

  const toggle = async () => {
    if (isSelfActive) {
      toast.error('자신의 계정을 비활성화할 수 없습니다.');
      return;
    }
    setIsToggling(true);
    try {
      await usersApi.setUserActive(user.id, { active: !user.isActive });
      // 성공 토스트는 두지 않는다 — 스위치·라벨이 곧 피드백이고, 우상단 토스트가 오른쪽 끝 스위치를 가린다(WP-397).
      onChanged(!user.isActive);
    } catch (error) {
      handleApiError(error, '상태 변경에 실패했습니다.');
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <>
      <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{isAgent ? '에이전트 비활성화' : '사용자 비활성화'}</AlertDialogTitle>
            <AlertDialogDescription>
              {isAgent
                ? '비활성화하면 이 AI 는 이 워크스페이스에 접속하거나 일할 수 없어요. 다른 워크스페이스는 그대로예요. 계속할까요?'
                : '비활성화하면 이 사용자는 이 워크스페이스에 들어올 수 없어요. 다른 워크스페이스와 계정은 그대로예요. 계속할까요?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setIsDialogOpen(false);
                void toggle();
              }}
            >
              비활성화
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SettingsSection
        title="활성 상태"
        description={
          isAgent
            ? '비활성 AI 는 이 워크스페이스에 접속하거나 일할 수 없어요. 다른 워크스페이스에는 영향이 없어요.'
            : '비활성 구성원은 이 워크스페이스에 들어올 수 없어요. 다른 워크스페이스에는 영향이 없어요.'
        }
      >
        <SettingsToggleRow
          label={user.isActive ? '활성' : '비활성'}
          description={offLockReason}
          control={
            <Switch
              checked={user.isActive}
              // 끄기는 확인 대화상자, 켜기는 바로 저장(#50).
              onCheckedChange={() => (user.isActive ? setIsDialogOpen(true) : void toggle())}
              disabled={isToggling || offLockReason != null}
              aria-label="활성 상태"
            />
          }
        />
      </SettingsSection>
    </>
  );
}

/**
 * 역할 할당 — 체크한 역할을 「역할 저장」으로 한 번에 반영한다. 대상 종류에 맞는 역할만 보인다(WP-728).
 * 선택 상태는 user.roles 로 시드한다 — 다른 대상으로 바뀌면 부모가 key 로 다시 마운트한다.
 * onSaved 는 저장 뒤 다시 읽은 계정을 알린다.
 */
export function UserRolesSection({
  user,
  allRoles,
  onSaved,
}: {
  user: AccessUser;
  allRoles: RoleResponse[];
  onSaved: (updated: UserDetailResponse) => void;
}) {
  const { user: currentUser } = useAuth();
  const [selectedRoleIds, setSelectedRoleIds] = useState(() => user.roles.map((r) => r.id));
  const [isSaving, setIsSaving] = useState(false);
  const isSelf = currentUser?.id === user.id;

  const toggleRole = (roleId: number, checked: boolean) => {
    setSelectedRoleIds((prev) => (checked ? [...prev, roleId] : prev.filter((id) => id !== roleId)));
  };

  const save = async () => {
    // 역할 0개 저장 방지 — 계정에는 역할이 최소 1개 있어야 한다(#150).
    if (selectedRoleIds.length === 0) {
      toast.error('역할은 최소 1개 이상 선택해야 합니다.');
      return;
    }
    setIsSaving(true);
    try {
      await usersApi.setUserRoles(user.id, { roleIds: selectedRoleIds });
      const { data: updated } = await usersApi.getUserById(user.id);
      setSelectedRoleIds(updated.roles.map((r) => r.id));
      onSaved(updated);
      toast.success('역할이 저장되었습니다.');
    } catch (error) {
      handleApiError(error, '역할 저장에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SettingsSection
      title="역할 할당"
      description={
        user.kind === 'AGENT'
          ? '이 AI 에게 줄 역할을 골라요. AI 에게는 관리자 역할이나 관리 권한이 든 역할을 줄 수 없어요.'
          : '이 구성원에게 줄 역할을 골라요.'
      }
    >
      <div className="space-y-3">
        {/* 대상 종류에 맞는 역할만(WP-728) — 이미 가진 역할은 뺄 수 있게 그대로 보인다. */}
        {assignableRoles(allRoles, user.kind, user.roles.map((r) => r.id)).map((role) => {
          // 자기 자신의 ADMIN 역할 제거 차단(#57)
          const isOwnAdminRole = isSelf && role.name === 'ADMIN';
          return (
            // flex-wrap+min-w-0 — 긴 역할명·설명이 한 줄을 넘기면 설명을 다음 줄로 내려 본문 가로 넘침을 막는다(WP-397 D2).
            <div key={role.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <Checkbox
                id={`role-${role.id}`}
                checked={selectedRoleIds.includes(role.id)}
                disabled={isOwnAdminRole}
                onCheckedChange={(checked) => toggleRole(role.id, checked === true)}
              />
              <Label htmlFor={`role-${role.id}`} className="flex min-w-0 items-center gap-2">
                {role.name}
                {role.isSystem && (
                  <Badge variant="outline" className="text-xs">시스템</Badge>
                )}
              </Label>
              {role.description && (
                <span className="min-w-0 text-sm break-words text-muted-foreground">{role.description}</span>
              )}
            </div>
          );
        })}
      </div>
      <Button onClick={save} disabled={isSaving}>
        {isSaving ? '저장 중...' : '역할 저장'}
      </Button>
    </SettingsSection>
  );
}
