import { zodResolver } from '@hookform/resolvers/zod';
import axios from 'axios';
import { ArrowLeft, Lock } from 'lucide-react';
import { useEffect, useMemo,useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate,useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { permissionsApi } from '../../api/permissions';
import { rolesApi } from '../../api/roles';
import { SettingsPage } from '../../components/layout/SettingsPage';
import { settingsFieldClass, SettingsSection } from '../../components/layout/SettingsSection';
import { settingsGuides } from '../../components/settings-guide/settingsGuides';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Skeleton } from '../../components/ui/skeleton';
import { cn } from '../../lib/utils';
import type { UpdateRoleFormData } from '../../lib/validations/role';
import { updateRoleSchema } from '../../lib/validations/role';
import type { ErrorResponse } from '../../types/auth';
import type { RoleDetailResponse } from '../../types/role';
import type { PermissionResponse } from '../../types/role';

export default function RoleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [role, setRole] = useState<RoleDetailResponse | null>(null);
  const [allPermissions, setAllPermissions] = useState<PermissionResponse[]>([]);
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingRole, setIsSavingRole] = useState(false);
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);
  const [roleError, setRoleError] = useState('');

  const form = useForm<UpdateRoleFormData>({
    resolver: zodResolver(updateRoleSchema),
    defaultValues: {
      name: '',
      description: '',
    },
  });

  useEffect(() => {
    const fetchData = async () => {
      if (!id) return;
      setIsLoading(true);
      try {
        const [roleRes, permRes] = await Promise.all([
          rolesApi.getRoleById(Number(id)),
          permissionsApi.getPermissions(),
        ]);
        setRole(roleRes.data);
        setAllPermissions(permRes.data);
        setSelectedPermissionIds(roleRes.data.permissions.map(p => p.id));
        form.reset({
          name: roleRes.data.name,
          description: roleRes.data.description ?? '',
        });
      } catch {
        toast.error('역할 정보를 불러오는데 실패했습니다.');
        navigate('/settings/roles');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [id, navigate, form]);

  const permissionsByCategory = useMemo(() => {
    const grouped: Record<string, PermissionResponse[]> = {};
    for (const perm of allPermissions) {
      if (!grouped[perm.category]) {
        grouped[perm.category] = [];
      }
      grouped[perm.category].push(perm);
    }
    return grouped;
  }, [allPermissions]);

  const handlePermissionToggle = (permId: number, checked: boolean) => {
    setSelectedPermissionIds(prev =>
      checked ? [...prev, permId] : prev.filter(id => id !== permId)
    );
  };

  const onRoleSubmit = async (data: UpdateRoleFormData) => {
    if (!role) return;
    setIsSavingRole(true);
    setRoleError('');
    try {
      await rolesApi.updateRole(role.id, {
        name: data.name,
        description: data.description || undefined,
      });
      const { data: updatedRole } = await rolesApi.getRoleById(role.id);
      setRole(updatedRole);
      toast.success('역할 정보가 업데이트되었습니다.');
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data) {
        const errData = error.response.data as ErrorResponse;
        setRoleError(errData.message || '역할 업데이트에 실패했습니다.');
      } else {
        setRoleError('역할 업데이트에 실패했습니다.');
      }
    } finally {
      setIsSavingRole(false);
    }
  };

  const handleSavePermissions = async () => {
    if (!role) return;
    setIsSavingPermissions(true);
    try {
      await rolesApi.setPermissions(role.id, { permissionIds: selectedPermissionIds });
      const { data: updatedRole } = await rolesApi.getRoleById(role.id);
      setRole(updatedRole);
      setSelectedPermissionIds(updatedRole.permissions.map(p => p.id));
      toast.success('권한이 저장되었습니다.');
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data) {
        const errData = error.response.data as ErrorResponse;
        toast.error(errData.message || '권한 저장에 실패했습니다.');
      } else {
        toast.error('권한 저장에 실패했습니다.');
      }
    } finally {
      setIsSavingPermissions(false);
    }
  };

  // 뒤로가기 버튼 — 제목 왼쪽에 배치하는 관례 준수 (#102).
  const backButton = (
    <Button variant="ghost" size="icon" onClick={() => navigate('/settings/roles')} aria-label="목록으로 돌아가기" title="목록으로 돌아가기">
      <ArrowLeft className="h-4 w-4" />
    </Button>
  );

  if (isLoading) {
    return (
      <SettingsPage title="역할 상세" icon={backButton} width="form" guide={settingsGuides.roleDetail}>
        <div className="space-y-4 py-6">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
      </SettingsPage>
    );
  }

  if (!role) return null;

  // 시스템 역할 배지를 제목 옆에 배치한 title 슬롯
  const pageTitle = (
    <span className="flex items-center gap-2">
      역할 상세
      {role.isSystem && <Badge variant="outline">시스템 역할</Badge>}
    </span>
  );

  return (
    <SettingsPage
      title={pageTitle}
      icon={backButton}
      width="form"
      guide={settingsGuides.roleDetail}
      // WP-414: AI 화면 맥락 — 저장된 역할 이름·권한 수(체크만 바꾼 미저장 권한은 싣지 않는다).
      aiContext={{
        focus: {
          type: '역할',
          label: role.name,
          facts: [
            ['권한 수', `${role.permissions.length}개`],
            ['시스템 역할', role.isSystem],
          ],
        },
      }}
    >
      {/* 역할 정보 — 이름·설명 수정. 시스템 역할은 잠금 안내와 함께 비활성 */}
      <SettingsSection title="역할 정보" description="목록과 구성원 화면에 보이는 이름과 설명이에요.">
        {/* 시스템 역할 잠금 안내 — 폼 필드가 disabled인 이유를 명시 (#676) */}
        {role.isSystem && (
          <div className="flex items-center gap-2 rounded-md border bg-muted p-3 text-sm text-muted-foreground">
            <Lock className="h-4 w-4 shrink-0" />
            시스템 역할은 이름·설명·권한을 수정할 수 없습니다.
          </div>
        )}
        <form onSubmit={form.handleSubmit(onRoleSubmit)} className="space-y-4">
          <div className={cn('space-y-2', settingsFieldClass)}>
            <Label htmlFor="role-name">역할 이름</Label>
            <Input
              id="role-name"
              {...form.register('name')}
              disabled={role.isSystem}
              className="disabled:bg-muted disabled:text-muted-foreground"
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="role-description">설명</Label>
            <Input
              id="role-description"
              {...form.register('description')}
              disabled={role.isSystem}
              className="disabled:bg-muted disabled:text-muted-foreground"
            />
            {/* WP-570: 설명 상한(255자) 위반을 칸 아래에 보여 준다 — 없으면 저장이 아무 안내 없이 막혔다 */}
            {form.formState.errors.description && (
              <p className="text-sm text-destructive">{form.formState.errors.description.message}</p>
            )}
          </div>
          {roleError && (
            <p className="text-sm text-destructive">{roleError}</p>
          )}
          {/* 시스템 역할은 수정 불가 — isSystem 플래그로 저장 버튼도 비활성화 */}
          <Button type="submit" disabled={isSavingRole || role.isSystem}>
            {isSavingRole ? '저장 중...' : '저장'}
          </Button>
        </form>
      </SettingsSection>

      {/* 권한 할당 — 카테고리별 체크박스(h3)는 섹션 제목(h2) 아래 계층 */}
      <SettingsSection title="권한 할당" description="이 역할을 가진 구성원이 할 수 있는 일이에요.">
        {Object.entries(permissionsByCategory).map(([category, perms]) => (
          <div key={category} className="space-y-3">
            <h3 className="text-sm font-semibold uppercase text-muted-foreground">{category}</h3>
            <div className="space-y-2">
              {perms.map((perm) => (
                <div key={perm.id} className="flex items-center gap-3">
                  <Checkbox
                    id={`perm-${perm.id}`}
                    checked={selectedPermissionIds.includes(perm.id)}
                    onCheckedChange={(checked) => handlePermissionToggle(perm.id, checked === true)}
                    disabled={role.isSystem}
                    className="disabled:bg-muted"
                  />
                  <Label
                    htmlFor={`perm-${perm.id}`}
                    className={`text-sm ${role.isSystem ? 'text-muted-foreground' : ''}`}
                  >
                    {perm.code}
                  </Label>
                  {perm.description && (
                    <span className="text-sm text-muted-foreground">- {perm.description}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {allPermissions.length === 0 && (
          <p className="text-sm text-muted-foreground">등록된 권한이 없습니다.</p>
        )}
        <Button onClick={handleSavePermissions} disabled={isSavingPermissions || role.isSystem}>
          {isSavingPermissions ? '저장 중...' : '권한 저장'}
        </Button>
      </SettingsSection>
    </SettingsPage>
  );
}
