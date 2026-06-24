import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { pageTitleClass } from '@/components/layout/sidebar-link';
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
import { Textarea } from '@/components/ui/textarea';

import { useProjectMembers } from '../../hooks/queries/useProjectMembers';
import { useDeleteProject, useProject, useUpdateProject } from '../../hooks/queries/useProjects';
import { useAuth } from '../../hooks/useAuth';
import { handleApiError } from '../../lib/api-error';
import { type UpdateProjectFormData,updateProjectSchema } from '../../lib/validations/project';
import { CustomFieldManagement } from './components/CustomFieldManagement';
import { IssueTypeManagement } from './components/IssueTypeManagement';
import { LabelManagement } from './components/LabelManagement';
import { MemberManagement } from './components/MemberManagement';

// 프로젝트 설정 — 기본 정보 수정 + 멤버 관리 + 위험 구역(삭제).
export default function ProjectSettingsPage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const project = useProject(key);
  const update = useUpdateProject(key);
  const remove = useDeleteProject();
  // 멤버 목록 기반으로 현재 사용자의 프로젝트 권한을 도출 — 라벨 편집 UI 게이팅에 사용.
  const members = useProjectMembers(key);
  const { user } = useAuth();
  const isOwner =
    members.data?.some((m) => m.userId === user?.id && m.role === 'OWNER') ?? false;
  // 개인 프로젝트는 멤버 개념이 없어 멤버 관리 섹션을 숨긴다.
  const isPersonal = project.data?.type === 'PERSONAL';

  const { register, handleSubmit, reset, formState: { errors } } = useForm<UpdateProjectFormData>({
    resolver: zodResolver(updateProjectSchema),
  });

  // 프로젝트 데이터 로드되면 폼 초기값 세팅
  useEffect(() => {
    if (project.data) {
      reset({
        name: project.data.name,
        description: project.data.description ?? '',
      });
    }
  }, [project.data, reset]);

  const onSubmit = async (data: UpdateProjectFormData) => {
    try {
      await update.mutateAsync(data);
      toast.success('프로젝트 정보를 저장했습니다');
    } catch (e) {
      handleApiError(e, '저장에 실패했습니다');
    }
  };

  // 삭제 토스트에 사용할 프로젝트 이름 — data 미로드 시 key로 fallback.
  const projectName = project.data?.name ?? key;

  // 프로젝트 삭제 확인 다이얼로그 open 상태 — shadcn AlertDialog 제어형.
  const [deletePending, setDeletePending] = useState(false);

  const onDelete = () => setDeletePending(true);

  const onDeleteConfirm = async () => {
    try {
      await remove.mutateAsync(key);
      toast.success(`프로젝트 "${projectName}"이 삭제되었습니다`);
      navigate('/projects');
    } catch (e) {
      handleApiError(e, '삭제에 실패했습니다');
    }
  };

  if (project.isLoading) return <p className="container mx-auto p-6 text-muted-foreground">로딩 중…</p>;

  return (
    <>
    <div className="container mx-auto p-6 space-y-8 max-w-3xl">
      <h1 className={pageTitleClass}>프로젝트 설정</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="settings-name">이름</label>
          <Input id="settings-name" {...register('name')} />
          {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="settings-desc">설명</label>
          <Textarea id="settings-desc" {...register('description')} rows={4} />
        </div>
        <Button type="submit" disabled={update.isPending}>{update.isPending ? '저장 중…' : '저장'}</Button>
      </form>

      {/* 개인 프로젝트는 AI 어시스턴트만 추가 가능(agentOnly), 팀 프로젝트는 일반 멤버 관리 */}
      {isPersonal
        ? <MemberManagement projectKey={key} agentOnly />
        : <MemberManagement projectKey={key} />}

      <LabelManagement projectKey={key} isOwner={isOwner} />

      <IssueTypeManagement projectKey={key} isOwner={isOwner} />

      <CustomFieldManagement projectKey={key} isOwner={isOwner} />

      <section className="border border-destructive rounded p-4 space-y-2">
        <h2 className="text-lg font-semibold text-destructive">위험 구역</h2>
        <p className="text-sm text-muted-foreground">
          프로젝트를 삭제하면 태스크/코멘트도 함께 숨겨집니다 (soft delete).
        </p>
        <Button variant="destructive" onClick={onDelete} disabled={remove.isPending} data-testid="project-delete">
          프로젝트 삭제
        </Button>
      </section>
    </div>
    {/* 프로젝트 삭제 확인 AlertDialog — window.confirm() 대체. */}
    <AlertDialog open={deletePending} onOpenChange={setDeletePending}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>프로젝트 삭제</AlertDialogTitle>
          <AlertDialogDescription>
            프로젝트 {key}를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onDeleteConfirm}>삭제</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
