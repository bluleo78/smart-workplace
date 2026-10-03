// 모바일 목록 화면 컨텍스트 builder(WP-191) — 탭 루트 목록(홈·채팅·작업·드라이브·노트)은 페이지 대신 사이드바만 그려
// 페이지가 컨텍스트를 등록하지 않는다. 사이드바와 같은 데이터로 "지금 보는 목록"을 AI 에게 알린다(view+scope 만).
import type { AiScreenContext } from '@/types/aiScreenContext';

import { buildFacts, withListState } from '../common';
import { buildWikiContext } from './wiki';

/** 이름 목록을 한 fact 값으로 — buildFacts 가 상한(200자)에서 자른다. 비면 null(생략). */
const names = (xs: string[]) => (xs.length ? xs.join(', ') : null);

/** 홈 — 보이는 위젯 제목들. */
export function buildHomeContext(input: { widgets: string[] }): AiScreenContext {
  return { view: '홈', scope: { label: '홈 대시보드', facts: buildFacts([['위젯', names(input.widgets)]]) } };
}

/** 채팅 목록 — 채널·DM 수와 안 읽음(0 이면 생략). */
export function buildChatListContext(input: {
  channelCount: number;
  dmCount: number;
  unread: number;
  threadUnread: number;
}): AiScreenContext {
  return {
    view: '채팅',
    scope: withListState(
      {
        label: '채팅 목록',
        // 안 읽음 0 은 의미 없는 정보라 생략(|| null).
        facts: buildFacts([
          ['채널', input.channelCount],
          ['DM', input.dmCount],
          ['안 읽음', input.unread || null],
          ['스레드 안 읽음', input.threadUnread || null],
        ]),
      },
      { count: input.channelCount + input.dmCount },
    ),
  };
}

/** 작업 목록 — 프로젝트와 고정 보기 이름. */
export function buildTaskListContext(input: { projects: string[]; pinnedViews: string[] }): AiScreenContext {
  return {
    view: '작업',
    scope: withListState(
      { label: '작업 목록', facts: buildFacts([['프로젝트', names(input.projects)], ['고정 보기', names(input.pinnedViews)]]) },
      { count: input.projects.length },
    ),
  };
}

/** 드라이브 공간 목록. */
export function buildDriveSpacesContext(input: { spaces: string[] }): AiScreenContext {
  return {
    view: '드라이브',
    scope: withListState({ label: '드라이브 공간 목록', facts: buildFacts([['공간', names(input.spaces)]]) }, { count: input.spaces.length }),
  };
}

/** 노트 공간의 페이지 목록 — 데스크톱 위키 화면과 같은 scope(정체성)를 쓰고 페이지 수만 더한다. */
export function buildWikiSpaceListContext(input: { spaceId: number; spaceName: string | null; pageCount: number | null }): AiScreenContext {
  const base = buildWikiContext({ spaceId: input.spaceId, spaceName: input.spaceName, page: null });
  return { ...base, scope: withListState(base.scope!, { count: input.pageCount ?? undefined }) };
}
