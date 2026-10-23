// 프로젝트 목록/상세 조회 + 생성/수정/삭제 mutation 훅.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { projectsApi } from '../../api/projects';
import type { PageResponse } from '../../types/common';
import type { CreateProjectRequest, ProjectResponse, UpdateProjectRequest } from '../../types/project';

export const projectKeys = {
  all: ['projects'] as const,
  list: (page: number, size: number) => [...projectKeys.all, 'list', page, size] as const,
  listAll: () => [...projectKeys.all, 'list', 'all'] as const,
  detail: (key: string) => [...projectKeys.all, 'detail', key] as const,
};

export function useProjects(page = 0, size = 20, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: projectKeys.list(page, size),
    queryFn: () => projectsApi.list({ page, size }).then(r => r.data),
    enabled: options?.enabled ?? true,
  });
}

// 전부 받을 때 한 번에 요청하는 크기 — 서버 상한(WP-644).
export const PROJECT_PAGE_MAX = 100;

// 전부 받기의 페이지 수 상한 — 응답이 이상해도(page 를 무시하는 등) 끝없이 요청하지 않게. 100×100 = 1만 개.
const MAX_PAGES = 100;

/**
 * 모든 페이지를 받아 한 페이지 모양으로 합친다(WP-863). 첫 페이지의 totalPages 로 나머지를 한꺼번에 요청하고,
 * 받는 사이 순서가 바뀌어 두 페이지에 걸친 프로젝트는 key(워크스페이스 안에서 유일)로 한 번만 남긴다(서버 정렬은 updated_at·id).
 */
export async function fetchAllProjects(
  fetchPage: (page: number, size: number) => Promise<PageResponse<ProjectResponse>>,
): Promise<PageResponse<ProjectResponse>> {
  const first = await fetchPage(0, PROJECT_PAGE_MAX);
  const pageCount = Math.min(first.totalPages ?? 1, MAX_PAGES);
  const rest = await Promise.all(Array.from({ length: Math.max(pageCount - 1, 0) }, (_, i) => fetchPage(i + 1, PROJECT_PAGE_MAX)));
  const seen = new Set<string>();
  const content = [first, ...rest]
    .flatMap((p) => p.content)
    .filter((p) => !seen.has(p.key) && seen.add(p.key));
  return { content, page: 0, size: content.length, totalElements: content.length, totalPages: 1 };
}

/**
 * 내가 멤버인(ADMIN 은 전체) 프로젝트를 모두 받는다(WP-863) — 목록 화면·이슈 사이드바·프로젝트 고르기처럼 「전부」가 필요한 곳용.
 * 첫 페이지(20개)만 받으면 21번째부터 목록·이름순 정렬·즐겨찾기에서 사라졌다. 홈 위젯처럼 일부만 보이는 곳은 useProjects 를 쓴다.
 */
export function useAllProjects() {
  return useQuery({
    queryKey: projectKeys.listAll(),
    queryFn: () => fetchAllProjects((page, size) => projectsApi.list({ page, size }).then((r) => r.data)),
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
