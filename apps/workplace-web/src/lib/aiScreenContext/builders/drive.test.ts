import { describe, expect, it } from 'vitest';

import { buildDriveContext } from './drive';

const base = { spaceId: 4, spaceName: '팀 드라이브', folderId: 11, folderPath: ['기획', '2026'], q: '', folderCount: 2, fileCount: 5 };

describe('buildDriveContext', () => {
  it('스페이스·폴더 경로·개수 — 폴더 id 는 parentId(list_drive_items 인자)', () => {
    expect(buildDriveContext(base)).toEqual({
      view: '드라이브',
      app: 'DRIVE',
      scope: { label: '드라이브 팀 드라이브 / 기획 / 2026', refs: { spaceId: '4', parentId: '11' }, facts: [{ label: '항목', value: '폴더 2 · 파일 5' }] },
    });
  });
  it('루트 폴더는 parentId 없음', () => {
    expect(buildDriveContext({ ...base, folderId: null, folderPath: [] }).scope!.refs).toEqual({ spaceId: '4' });
  });
  it('스페이스 이름 미로드면 #id 폴백, 개수 미로드면 항목 fact 생략', () => {
    const ctx = buildDriveContext({ ...base, spaceName: null, folderId: null, folderPath: [], folderCount: null, fileCount: null });
    expect(ctx.scope!.label).toBe('드라이브 #4');
    expect(ctx.scope!.facts ?? []).toEqual([]);
  });
  it('경로 미확보(folderPath 빈 배열)여도 parentId 는 유지, 라벨은 스페이스만', () => {
    const ctx = buildDriveContext({ ...base, folderPath: [] });
    expect(ctx.scope!.label).toBe('드라이브 팀 드라이브');
    expect(ctx.scope!.refs).toEqual({ spaceId: '4', parentId: '11' });
  });
  it('검색 중에는 항목 개수 fact 를 생략하고 검색어만 싣는다', () => {
    const ctx = buildDriveContext({ ...base, q: '회의록' });
    expect(ctx.scope!.facts).toEqual([{ label: '검색어', value: '회의록' }]);
  });
});
