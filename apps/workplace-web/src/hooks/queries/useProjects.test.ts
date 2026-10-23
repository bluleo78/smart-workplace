// fetchAllProjects(WP-863) — 첫 페이지만 받던 프로젝트 목록을 마지막 페이지까지 이어 받는다.
import { describe, expect, it, vi } from 'vitest';

import type { ProjectResponse } from '../../types/project';
import { fetchAllProjects, PROJECT_PAGE_MAX } from './useProjects';

const project = (n: number) => ({ id: n, key: `P${n}`, name: `프로젝트 ${n}` }) as unknown as ProjectResponse;
const all = Array.from({ length: 230 }, (_, i) => project(i + 1));
const page = (p: number, size: number) => ({
  content: all.slice(p * size, (p + 1) * size),
  page: p,
  size,
  totalElements: all.length,
  totalPages: Math.ceil(all.length / size),
});

describe('fetchAllProjects', () => {
  it('서버 상한 크기로 마지막 페이지까지 받아 한 목록으로 합친다', async () => {
    const fetchPage = vi.fn(async (p: number, size: number) => page(p, size));
    const res = await fetchAllProjects(fetchPage);
    expect(fetchPage.mock.calls).toEqual([
      [0, PROJECT_PAGE_MAX],
      [1, PROJECT_PAGE_MAX],
      [2, PROJECT_PAGE_MAX],
    ]);
    expect(res.content.map((p) => p.id)).toEqual(all.map((p) => p.id));
    expect(res.totalElements).toBe(230);
  });

  it('받는 사이 순서가 바뀌어 두 페이지에 걸친 프로젝트는 한 번만 남긴다', async () => {
    // 100번째가 다음 페이지 첫째로 다시 온 경우.
    const fetchPage = vi.fn(async (p: number) =>
      p === 0
        ? { content: all.slice(0, 100), page: 0, size: 100, totalElements: 101, totalPages: 2 }
        : { content: [all[99], all[100]], page: 1, size: 100, totalElements: 101, totalPages: 2 },
    );
    const res = await fetchAllProjects(fetchPage);
    expect(res.content.map((p) => p.id)).toEqual(all.slice(0, 101).map((p) => p.id));
    expect(res.totalElements).toBe(101);
  });

  it('page 를 무시하는 응답이어도 상한에서 멈춘다', async () => {
    const fetchPage = vi.fn(async () => ({ content: all.slice(0, 100), page: 0, size: 100, totalElements: 1e9, totalPages: 1e7 }));
    await fetchAllProjects(fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(100);
  });

  it('한 페이지에 다 들어오면 한 번만 요청한다', async () => {
    const fetchPage = vi.fn(async () => ({ content: [project(1)], page: 0, size: 100, totalElements: 1, totalPages: 1 }));
    expect((await fetchAllProjects(fetchPage)).content).toHaveLength(1);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
