import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useCallback,useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { SettingsPage } from '@/components/layout/SettingsPage';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { FormField } from '@/components/ui/form-field';
import { TableEmptyRow } from '@/components/ui/table-empty';
import { TableSkeletonRows } from '@/components/ui/table-skeleton';
import { extractApiError, handleApiError } from '@/lib/api-error';
import { iGa } from '@/lib/utils';

import { rolesApi } from '../../api/roles';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { clickableRowProps } from '../../lib/clickableRowProps';
import type { CreateRoleFormData } from '../../lib/validations/role';
import { createRoleSchema } from '../../lib/validations/role';
import type { RoleResponse } from '../../types/role';

export default function RoleListPage() {
  const navigate = useNavigate();
  const [roles, setRoles] = useState<RoleResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createError, setCreateError] = useState('');

  const form = useForm<CreateRoleFormData>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: {
      name: '',
      description: '',
    },
  });

  const fetchRoles = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data } = await rolesApi.getRoles();
      setRoles(data);
    } catch {
      toast.error('역할 목록을 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  // dialog가 열릴 때 폼 상태 및 에러 초기화 — 닫혀있는 동안 react-hook-form 상태가 유지되므로 재열기 시 reset 필요.
  useEffect(() => {
    if (!dialogOpen) return;
    form.reset();
    setCreateError('');
  }, [dialogOpen, form]);

  const onCreateSubmit = async (data: CreateRoleFormData) => {
    try {
      setCreateError('');
      await rolesApi.createRole({
        name: data.name,
        description: data.description || undefined,
      });
      toast.success('역할이 생성되었습니다.');
      setDialogOpen(false);
      form.reset();
      fetchRoles();
    } catch (error) {
      setCreateError(extractApiError(error, '역할 생성에 실패했습니다.'));
    }
  };

  const handleDelete = async (role: RoleResponse) => {
    try {
      await rolesApi.deleteRole(role.id);
      toast.success(`역할 "${role.name}"${iGa(role.name)} 삭제되었습니다.`);
      fetchRoles();
    } catch (error) {
      handleApiError(error, '역할 삭제에 실패했습니다.');
    }
  };

  return (
    <SettingsPage
      title="역할"
      actions={
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              역할 추가
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>새 역할 생성</DialogTitle>
              <DialogDescription className="sr-only">새로운 사용자 역할을 생성합니다.</DialogDescription>
            </DialogHeader>
            <form onSubmit={form.handleSubmit(onCreateSubmit)} className="space-y-4">
              <FormField
                label="역할 이름"
                htmlFor="role-name"
                error={form.formState.errors.name?.message}
              >
                <Input
                  id="role-name"
                  {...form.register('name')}
                />
              </FormField>
              <FormField
                label="설명 (선택)"
                htmlFor="role-description"
                error={form.formState.errors.description?.message}
              >
                <Input
                  id="role-description"
                  {...form.register('description')}
                />
              </FormField>
              {createError && (
                <p role="alert" className="text-sm text-destructive">{createError}</p>
              )}
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? '생성 중...' : '생성'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      }
    >
      <div className="rounded-md border">
        <Table aria-label="역할 목록">
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              {/* 좁은 화면은 유형·설명 열을 숨기고 이름 아래 줄로 모은다 — 설명 길이만큼 표가 넓어져 삭제 버튼이 화면 밖에 있었다(WP-686) */}
              <TableHead className="hidden md:table-cell">유형</TableHead>
              <TableHead className="hidden md:table-cell">설명</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeletonRows columns={4} rows={3} />
            ) : roles.length > 0 ? (
              roles.map((role) => (
                <TableRow
                  key={role.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors row-hover focus-visible:ring-2 focus-visible:ring-ring"
                  {...clickableRowProps(() => navigate(`/settings/roles/${role.id}`), `${role.name} 상세 보기`)}
                >
                  <TableCell className="whitespace-normal font-medium md:whitespace-nowrap">
                    <span className="break-all">{role.name}</span>
                    {/* 모바일 전용 — 숨긴 유형·설명 열의 값. 긴 설명은 두 줄까지만 보이고 전체는 상세 화면에 */}
                    <div className="mt-1 space-y-1 font-normal md:hidden">
                      <RoleKindBadge isSystem={role.isSystem} />
                      {role.description && (
                        <p className="line-clamp-2 text-xs text-muted-foreground">{role.description}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <RoleKindBadge isSystem={role.isSystem} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{role.description ?? '-'}</TableCell>
                  <TableCell>
                    {!role.isSystem && (
                      <DeleteConfirmDialog
                        entityName="역할"
                        itemName={role.name}
                        onConfirm={() => handleDelete(role)}
                        trigger={
                          /* 삭제 버튼 — 아이콘만 있으므로 스크린 리더를 위해 aria-label 필수 */
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`${role.name} 역할 삭제`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        }
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyRow colSpan={4} message="역할이 없습니다." />
            )}
          </TableBody>
        </Table>
      </div>
    </SettingsPage>
  );
}

/** 역할 유형 배지 — 시스템 / 사용자 정의. 데스크톱 유형 열과 모바일 이름 아래 줄이 같이 쓴다. */
function RoleKindBadge({ isSystem }: { isSystem: boolean }) {
  return isSystem ? <Badge variant="outline">시스템</Badge> : <Badge variant="secondary">사용자 정의</Badge>;
}
