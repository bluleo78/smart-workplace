import { describe, expect, it } from 'vitest';

import {
  buildChatListContext,
  buildDriveSpacesContext,
  buildHomeContext,
  buildTaskListContext,
  buildWikiSpaceListContext,
} from './mobileLists';

describe('모바일 목록 화면 컨텍스트', () => {
  it('홈 — 보이는 위젯 제목', () => {
    expect(buildHomeContext({ widgets: ['내 작업', '오늘 일정'] })).toEqual({
      view: '홈',
      scope: { label: '홈 대시보드', facts: [{ label: '위젯', value: '내 작업, 오늘 일정' }] },
    });
  });
  it('채팅 목록 — 개수, 안 읽음이 0 이면 생략', () => {
    expect(buildChatListContext({ channelCount: 3, dmCount: 2, unread: 0, threadUnread: 0 })).toEqual({
      view: '채팅',
      scope: { label: '채팅 목록', count: 5, facts: [{ label: '채널', value: '3' }, { label: 'DM', value: '2' }] },
    });
    expect(buildChatListContext({ channelCount: 1, dmCount: 0, unread: 4, threadUnread: 1 }).scope!.facts).toEqual([
      { label: '채널', value: '1' },
      { label: 'DM', value: '0' },
      { label: '안 읽음', value: '4' },
      { label: '스레드 안 읽음', value: '1' },
    ]);
  });
  it('작업 — 프로젝트·고정 보기', () => {
    expect(buildTaskListContext({ projects: ['WP', '개인'], pinnedViews: [] })).toEqual({
      view: '작업',
      scope: { label: '작업 목록', count: 2, facts: [{ label: '프로젝트', value: 'WP, 개인' }] },
    });
  });
  it('드라이브 — 공간 목록', () => {
    expect(buildDriveSpacesContext({ spaces: ['팀', '내 드라이브'] })).toEqual({
      view: '드라이브',
      scope: { label: '드라이브 공간 목록', count: 2, facts: [{ label: '공간', value: '팀, 내 드라이브' }] },
    });
  });
  it('노트 공간 페이지 목록 — 위키 스페이스 scope 와 같은 정체성 + 페이지 수', () => {
    expect(buildWikiSpaceListContext({ spaceId: 7, spaceName: '기획', pageCount: 12 })).toEqual({
      view: '위키',
      scope: { label: '위키 스페이스 기획', refs: { spaceId: '7' }, count: 12 },
    });
    expect(buildWikiSpaceListContext({ spaceId: 7, spaceName: null, pageCount: null }).scope).toEqual({
      label: '위키 스페이스 #7',
      refs: { spaceId: '7' },
    });
  });
});
