import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { SharedMemoryLink } from '@/components/ai/SharedMemoryLink';
import { SettingsPage } from '@/components/layout/SettingsPage';
import { settingsFieldClass, SettingsSection } from '@/components/layout/SettingsSection';
import { DEFAULT_PROJECT_UNDELETABLE, projectSettingsGuide } from '@/components/settings-guide/settingsGuides';
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
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { PROJECT_TYPE_LABEL } from '@/lib/projectType';
import { cn, subjectParticle } from '@/lib/utils';

import { useProjectMembers } from '../../hooks/queries/useProjectMembers';
import { useDeleteProject, useProject, useUpdateProject } from '../../hooks/queries/useProjects';
import { useAuth } from '../../hooks/useAuth';
import { handleApiError } from '../../lib/api-error';
import { canManageProject, isProjectOwner } from '../../lib/projectPermissions';
import { canEditStatuses } from '../../lib/projectStatuses';
import { type UpdateProjectFormData,updateProjectSchema } from '../../lib/validations/project';
import { ComponentManagement } from './components/ComponentManagement';
import { CustomFieldManagement } from './components/CustomFieldManagement';
import { IssueTypeManagement } from './components/IssueTypeManagement';
import { LabelManagement } from './components/LabelManagement';
import { MemberManagement } from './components/MemberManagement';
import { ProjectUnavailableState } from './components/ProjectUnavailableState';
import { RepositorySettings } from './components/RepositorySettings';
import { StatusManagement } from './components/status/StatusManagement';

/** WP-414: AI 화면 맥락에 싣는 프로젝트 종류 표시 문구. */

// 프로젝트 설정 — 기본 정보 수정 + 멤버 관리 + 위험 구역(삭제).
export default function ProjectSettingsPage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const project = useProject(key);
  const update = useUpdateProject(key);
  // 탭 제목 — 「설정 · {프로젝트}」(WP-814).
  useDocumentTitle(['설정', project.data?.name]);
  const remove = useDeleteProject();
  // 멤버 목록 기반으로 현재 사용자의 프로젝트 권한을 도출 — 라벨 편집 UI 게이팅에 사용.
  const members = useProjectMembers(key);
  const { user, isAdmin } = useAuth();
  const isOwner = isProjectOwner(members.data, user?.id);
  // 라벨은 멤버면 만들 수 있다(WP-394). ADMIN 은 멤버가 아니어도 서버가 통과시킨다(개인 프로젝트 제외).
  const isMember = members.data?.some((m) => m.userId === user?.id) ?? false;
  // 개인 프로젝트는 멤버 개념이 없어 멤버 관리 섹션을 숨긴다.
  const isPersonal = project.data?.type === 'PERSONAL';
  // 기본 정보 저장·멤버 관리·삭제 권한(WP-479) — 서버와 같은 규칙. 멤버 목록을 받기 전엔 OWNER 여부를 몰라 잠시 읽기 전용으로 보인다.
  const canManage = canManageProject(isOwner, isAdmin, isPersonal);
  // 기본 개인 프로젝트(사용자마다 하나 보장)는 서버가 삭제를 거절한다 — 삭제 버튼을 미리 막는 데 쓴다(WP-857).
  const isDefaultProject = project.data?.isDefault ?? false;

  const { register, handleSubmit, reset, formState: { errors } } = useForm<UpdateProjectFormData>({
    resolver: zodResolver(updateProjectSchema),
  });

  // 이름·설명을 받으면(저장 뒤 포함) 폼 초기값 세팅 — 객체가 아니라 두 값에 묶는다. 다른 섹션(연결된 저장소, WP-1011)을
  // 저장해 프로젝트를 다시 받아도 이름·설명이 그대로면 쓰던 입력을 지우지 않게.
  const savedKey = project.data?.key;
  const savedName = project.data?.name;
  const savedDescription = project.data?.description;
  useEffect(() => {
    if (savedName !== undefined) {
      reset({ name: savedName, description: savedDescription ?? '' });
    }
    // 키도 묶는다 — 이름·설명이 같은 다른 프로젝트로 옮겨 가도 쓰던 입력이 그 프로젝트로 넘어가지 않게.
  }, [savedKey, savedName, savedDescription, reset]);

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
  // 삭제 확인창의 대상 — 이름이 있으면 「이름」(키), 없으면 키만(「P1」(P1)처럼 겹치지 않게, WP-857).
  const deleteTarget = project.data ? `「${project.data.name}」(${key})` : key;

  // 프로젝트 삭제 확인 다이얼로그 open 상태 — shadcn AlertDialog 제어형.
  const [deletePending, setDeletePending] = useState(false);

  const onDelete = () => setDeletePending(true);

  const onDeleteConfirm = async () => {
    try {
      await remove.mutateAsync(key);
      toast.success(`프로젝트 "${projectName}"${subjectParticle(projectName)} 삭제되었습니다`);
      navigate('/projects');
    } catch (e) {
      handleApiError(e, '삭제에 실패했습니다');
    }
  };

  // 프로젝트를 볼 수 없으면(403·404) 관리 화면 대신 접근 불가 안내(WP-480). 훅을 모두 부른 뒤에 분기한다.
  if (project.error) return <ProjectUnavailableState />;

  // 헤더는 로딩 중에도 같은 모양으로 먼저 보여, 데이터 도착 시 헤더가 뒤늦게 튀어나오지 않게 한다 — 로딩 분기는 본문 안에서만.
  // 설정 폼 폭 + 주석 섹션 — 다른 설정 화면과 같은 폭 체계(WP-397).
  return (
    <SettingsPage
      width="form"
      guide={projectSettingsGuide(project.data)}
      // WP-414: AI 화면 맥락 — 프로젝트 키·이름·종류(로드된 뒤에만).
      aiContext={project.data ? {
        focus: {
          type: '프로젝트',
          label: project.data.name,
          refs: { projectKey: project.data.key },
          facts: [
            ['키', project.data.key],
            ['종류', PROJECT_TYPE_LABEL[project.data.type]],
          ],
        },
      } : null}
      data-testid="project-settings-page"
      icon={
        <Button
          variant="ghost"
          size="icon"
          aria-label="프로젝트로 돌아가기"
          onClick={() => navigate(`/projects/${key}`)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
      }
      title="프로젝트 설정"
      meta={<span className="text-muted-foreground">{project.data?.key}</span>}
    >
      {project.isLoading ? (
        <p className="py-6 text-muted-foreground">로딩 중…</p>
      ) : (
        <>
          <SettingsSection title="기본 정보" description="프로젝트 목록과 상단에 보이는 이름과 설명이에요.">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {/* OWNER 가 아니면 읽기 전용(WP-479) — 저장을 눌러야 403 이 나던 것을 미리 알린다. */}
              {!canManage && (
                <p className="text-sm text-muted-foreground" data-testid="project-settings-readonly">
                  기본 정보·멤버·삭제는 프로젝트 소유자만 바꿀 수 있어요.
                </p>
              )}
              <div className={cn('space-y-1', settingsFieldClass)}>
                <label className="text-sm font-medium" htmlFor="settings-name">이름</label>
                <Input
                  id="settings-name"
                  aria-invalid={!!errors.name || undefined}
                  aria-describedby={errors.name ? 'settings-name-error' : undefined}
                  {...register('name')}
                  disabled={!canManage}
                />
                {errors.name && (
                  <p id="settings-name-error" role="alert" className="text-sm text-destructive">
                    {errors.name.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="settings-desc">설명</label>
                <Textarea
                  id="settings-desc"
                  aria-invalid={!!errors.description || undefined}
                  aria-describedby={errors.description ? 'settings-desc-error' : undefined}
                  {...register('description')}
                  rows={4}
                  disabled={!canManage}
                />
                {/* 2000자 초과 등 검증 실패를 그리지 않으면 저장을 눌러도 요청도 안내도 없어 저장된 줄 안다(WP-929). */}
                {errors.description && (
                  <p id="settings-desc-error" role="alert" className="text-sm text-destructive">
                    {errors.description.message}
                  </p>
                )}
              </div>
              {canManage && (
                <Button type="submit" disabled={update.isPending}>{update.isPending ? '저장 중…' : '저장'}</Button>
              )}
            </form>
          </SettingsSection>

          {/* 연결된 저장소(WP-1011) — AI 가 이슈를 처리할 코드 저장소. 기본 정보와 같은 권한으로 고친다. */}
          {/* key — 다른 프로젝트로 옮기면 새로 띄워, 저장하지 않은 입력이 그 프로젝트로 넘어가지 않게(둘 다 빈 저장소면 값이 같아 맞추지 않는다). */}
          {project.data && <RepositorySettings key={project.data.key} project={project.data} canManage={canManage} />}

          {/* WP-386: 공용 AI 메모리 — 설정 › AI 비서 › 메모리 「공용 메모리」에서 관리(개인 프로젝트는 공유 대상이 아니라 숨김). */}
          {!isPersonal && project.data && <SharedMemoryLink projectId={project.data.id} />}

          {/* 개인 프로젝트는 AI 어시스턴트만 추가 가능(agentOnly), 팀 프로젝트는 일반 멤버 관리 */}
          {isPersonal
            ? <MemberManagement projectKey={key} agentOnly ownerId={project.data?.ownerId} canManage={canManage} />
            : <MemberManagement projectKey={key} canManage={canManage} openProject={project.data?.type === 'OPEN'} />}

          {/* 상태(WP-809) — 개인 프로젝트는 상태를 고칠 수 없어(서버 400) 섹션을 그리지 않는다. 편집은 OWNER 만, 멤버는 읽기 전용. */}
          {!isPersonal && <StatusManagement projectKey={key} canEdit={canEditStatuses(isOwner, project.data?.type)} />}

          <LabelManagement
            projectKey={key}
            canCreate={isMember || (isAdmin && !isPersonal)}
            isOwner={isOwner}
          />

          {/* 구성요소(WP-933) — 라벨 아래. 개인 프로젝트는 구성요소를 만들 수 없어(서버 400) 그리지 않는다. 관리는 OWNER·ADMIN, 그 밖은 읽기 전용. */}
          {!isPersonal && project.data && <ComponentManagement projectKey={key} canManage={canManage} />}

          <IssueTypeManagement projectKey={key} isOwner={isOwner} />

          <CustomFieldManagement projectKey={key} isOwner={isOwner} />

          {/* 삭제는 소유자만(WP-479) — 권한이 없으면 위험 구역 자체를 그리지 않는다. */}
          {canManage && (
            <SettingsSection
              tone="danger"
              title="위험 구역"
              description={isDefaultProject
                ? DEFAULT_PROJECT_UNDELETABLE
                : '프로젝트를 삭제하면 이슈와 코멘트도 함께 숨겨져요.'}
            >
              {/* 기본 개인 프로젝트는 서버가 409 로 거절한다(WP-857) — 확인창까지 간 뒤에 거절되지 않게 삭제 버튼을 두지 않고
                  위 설명으로 이유를 미리 알린다(막힌 버튼은 키보드 초점을 받지 못해 이유가 전달되지 않는다). */}
              {!isDefaultProject && (
                <Button variant="destructive" onClick={onDelete} disabled={remove.isPending} data-testid="project-delete">
                  프로젝트 삭제
                </Button>
              )}
            </SettingsSection>
          )}
        </>
      )}
      {/* 프로젝트 삭제 확인 AlertDialog — window.confirm() 대체. */}
      <AlertDialog open={deletePending} onOpenChange={setDeletePending}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>프로젝트 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              {/* 키·이름 뒤 조사가 받침에 따라 틀리지 않게 「프로젝트를」로 맺고, 위험 구역 설명과 같은 말(함께 숨겨짐)로 알린다(WP-857). */}
              {deleteTarget} 프로젝트를 삭제할까요? 이슈와 코멘트도 함께 숨겨지고, 화면에서 되돌릴 수 없어요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDeleteConfirm}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  );
}
