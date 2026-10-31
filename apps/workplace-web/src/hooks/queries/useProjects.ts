// 프로젝트 목록/상세 조회 + 생성/수정/삭제 mutation 훅.

import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
  return useQuery(allProjectsQuery());
}

/** 「내 프로젝트 전부」 조회 설정 — useAllProjects·useVisibleProjectKeys 가 같은 캐시(키·조회 함수)를 쓰도록 한곳에 둔다. */
function allProjectsQuery() {
  return queryOptions({
    queryKey: projectKeys.listAll(),
    queryFn: () => fetchAllProjects((page, size) => projectsApi.list({ page, size }).then((r) => r.data)),
  });
}

/** 프로젝트 목록 → 키 집합. 모듈 범위 함수라 select 결과가 목록이 바뀔 때만 새로 만들어진다. */
const toProjectKeySet = (page: PageResponse<ProjectResponse>): ReadonlySet<string> => new Set(page.content.map((p) => p.key));

/**
 * 내가 속한(ADMIN 은 전체) 프로젝트 키 집합(WP-1237) — 채팅·코멘트 본문의 이슈 키(「WP-12」)를 링크로 만들지 정한다.
 * useAllProjects 와 같은 캐시(allProjectsQuery)를 써서 본문 이슈 키가 몇 개든 목록은 한 번만 받는다. 받기 전·실패면 undefined(링크 없이 글자).
 */
export function useVisibleProjectKeys(): ReadonlySet<string> | undefined {
  return useQuery({
    ...allProjectsQuery(),
    select: toProjectKeySet,
    // 프로젝트가 새로 생기거나 빠지는 일은 드물다 — 메시지 행마다 다시 받지 않게 5분 동안 그대로 쓴다.
    staleTime: 5 * 60_000,
  }).data;
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
