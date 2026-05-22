// 프로젝트 목록/상세 조회 + 생성/수정/삭제 mutation 훅.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { projectsApi } from '../../api/projects';
import type { CreateProjectRequest, UpdateProjectRequest } from '../../types/project';

export const projectKeys = {
  all: ['projects'] as const,
  list: (page: number, size: number) => [...projectKeys.all, 'list', page, size] as const,
  detail: (key: string) => [...projectKeys.all, 'detail', key] as const,
};

export function useProjects(page = 0, size = 20) {
  return useQuery({
    queryKey: projectKeys.list(page, size),
    queryFn: () => projectsApi.list({ page, size }).then(r => r.data),
  });
}

export function useProject(key: string) {
  return useQuery({
    queryKey: projectKeys.detail(key),
    queryFn: () => projectsApi.get(key).then(r => r.data),
    enabled: !!key,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProjectRequest) => projectsApi.create(data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: projectKeys.all }); },
  });
}

export function useUpdateProject(key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateProjectRequest) => projectsApi.update(key, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.detail(key) });
      qc.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => projectsApi.remove(key),
    onSuccess: () => { qc.invalidateQueries({ queryKey: projectKeys.all }); },
  });
}
