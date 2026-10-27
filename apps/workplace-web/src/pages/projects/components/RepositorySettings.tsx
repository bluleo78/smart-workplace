import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { settingsFieldClass, SettingsSection } from '@/components/layout/SettingsSection';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { useUpdateProject } from '../../../hooks/queries/useProjects';
import { handleApiError } from '../../../lib/api-error';
import { type ProjectRepositoryFormData, projectRepositorySchema } from '../../../lib/validations/project';
import type { ProjectResponse } from '../../../types/project';

interface RepositorySettingsProps {
  project: ProjectResponse;
  /** 저장 권한(기본 정보와 같은 규칙 — 소유자·관리자). 없으면 읽기 전용. */
  canManage: boolean;
}

/**
 * 프로젝트 설정 「연결된 저장소」(WP-1011) — AI 가 이 프로젝트의 이슈를 처리할 때 clone 해 쓰는 코드 저장소 주소와 기본 브랜치.
 * 외부 AI 를 띄우는 스킬(start-agent)이 이 칸이 있는 프로젝트만 맡는다. 개발이 아닌 프로젝트는 비워 둔다. 빈 값으로 저장하면 지운다.
 */
export function RepositorySettings({ project, canManage }: RepositorySettingsProps) {
  const update = useUpdateProject(project.key);
  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<ProjectRepositoryFormData>({
    resolver: zodResolver(projectRepositorySchema),
  });

  // 프로젝트를 다시 받으면(저장 뒤 포함) 폼을 서버 값으로 맞춘다.
  useEffect(() => {
    reset({ repositoryUrl: project.repositoryUrl ?? '', repositoryBranch: project.repositoryBranch ?? '' });
  }, [project.repositoryUrl, project.repositoryBranch, reset]);

  const onSubmit = async (data: ProjectRepositoryFormData) => {
    try {
      // 주소를 지우면 브랜치도 지운다(서버와 같은 규칙) — 옛 브랜치가 다음 연결에 따라붙지 않게.
      const payload = data.repositoryUrl ? data : { repositoryUrl: '', repositoryBranch: '' };
      await update.mutateAsync(payload);
      // 저장한 값(다듬은 값)으로 바로 맞춘다 — 공백만 달라 서버 값이 그대로면 위 effect 가 돌지 않아 폼이 「바뀜」으로 남는다.
      reset(payload);
      toast.success(data.repositoryUrl ? '연결된 저장소를 저장했습니다' : '저장소 연결을 지웠습니다');
    } catch (e) {
      handleApiError(e, '저장에 실패했습니다');
    }
  };

  return (
    <SettingsSection
      title="연결된 저장소"
      description="AI 가 이 프로젝트의 이슈를 처리할 때 쓰는 코드 저장소예요. 개발 프로젝트가 아니면 비워 두세요."
      data-testid="project-repository"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* 주소는 긴 값이라 폭 상한(settingsFieldClass)을 두지 않는다(WP-397). */}
        <FormField label="저장소 주소" htmlFor="settings-repo-url" error={errors.repositoryUrl?.message}>
          <Input
            id="settings-repo-url"
            placeholder="https://github.com/조직/저장소.git"
            {...register('repositoryUrl')}
            disabled={!canManage}
          />
        </FormField>
        <div className={cn('space-y-1', settingsFieldClass)}>
          {/* FormField 는 오류가 있을 때만 aria-describedby 를 오류로 바꾼다 — 평소엔 아래 안내 문구를 가리킨다. */}
          <FormField label="기본 브랜치" htmlFor="settings-repo-branch" error={errors.repositoryBranch?.message}>
            <Input
              id="settings-repo-branch"
              placeholder="비워 두면 저장소의 기본 브랜치"
              aria-describedby="settings-repo-branch-hint"
              {...register('repositoryBranch')}
              disabled={!canManage}
            />
          </FormField>
          {!errors.repositoryBranch && (
            <p id="settings-repo-branch-hint" className="text-sm text-muted-foreground">
              AI 가 작업 브랜치를 만들고 PR 을 올리는 기준이에요.
            </p>
          )}
        </div>
        {canManage && (
          <Button type="submit" disabled={update.isPending || !isDirty}>
            {update.isPending ? '저장 중…' : '저장'}
          </Button>
        )}
      </form>
    </SettingsSection>
  );
}
