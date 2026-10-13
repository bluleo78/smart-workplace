import { describe, expect, it } from 'vitest';

import type { AiScreenContext } from '@/types/aiScreenContext';

import {
  fixedStarters,
  GENERAL_STARTERS,
  isTailoredContext,
  settleStarterView,
  starterContextKey,
  starterHeading,
  type StarterView,
} from './starterSuggestions';

const focus = (type: string, refs: Record<string, string>): AiScreenContext => ({ view: 'v', focus: { type, label: 'L', refs } });

describe('fixedStarters — 스펙 §4.4 표', () => {
  it('일반(화면 참고 없음·대상 없는 화면·식별자 없는 새 일정)은 4개', () => {
    expect(GENERAL_STARTERS).toEqual(['오늘 일정 요약해줘', '나를 멘션한 메시지 정리해줘', '내 작업 우선순위 정리해줘', '답장이 필요한 메일 알려줘']);
    expect(fixedStarters(null)).toEqual(GENERAL_STARTERS);
    expect(fixedStarters({ view: '이슈 목록', scope: { label: '프로젝트 WP' } })).toEqual(GENERAL_STARTERS);
    expect(fixedStarters(focus('일정', {}))).toEqual(GENERAL_STARTERS);
  });
  it.each([
    ['이슈', { issueKey: 'WP-1' }, ['이 이슈 관련 작업 정리해줘', '비슷한 이슈 찾아줘', '이 이슈를 막고 있는 이슈 상태 알려줘']],
    ['위키 페이지', { pageId: '3' }, ['이 노트에서 할 일 뽑아줘', '이 노트와 관련된 이슈 찾아줘', '이 노트를 링크한 문서 보여줘']],
    ['메일', { messageId: '4' }, ['이 메일에서 할 일 뽑아줘', '이 메일과 관련된 이슈 찾아줘', '보낸 사람과 최근 주고받은 메일 보여줘']],
    ['파일', { driveFileId: '5' }, ['이 파일 핵심 내용 정리해줘', '이 파일과 관련된 이슈 찾아줘', '이 파일에서 할 일 뽑아줘']],
    ['스레드', { messageId: '6' }, ['이 스레드 결론 정리해줘', '이 스레드에서 할 일 뽑아줘', '이 스레드와 관련된 이슈 찾아줘']],
    ['일정', { eventId: '7' }, ['이 회의 준비할 것 정리해줘', '참석자들과 관련된 진행 중 이슈 보여줘', '이 일정 앞뒤로 비는 시간 알려줘']],
    ['연락처', { username: 'kim' }, ['이 사람과 최근 주고받은 메일 보여줘', '이 사람이 담당한 진행 중 이슈 보여줘', '이 사람과 다음 회의 일정 알려줘']],
    ['연락처', { externalId: '9' }, ['이 사람과 최근 주고받은 메일 보여줘', '이 사람과 다음 회의 일정 알려줘']],
  ])('%s %o', (type, refs, expected) => {
    expect(fixedStarters(focus(type, refs))).toEqual(expected);
  });
  it('표에 없는 대상 종류는 일반', () => {
    expect(fixedStarters(focus('프로젝트', { projectKey: 'WP' }))).toEqual(GENERAL_STARTERS);
  });
});

describe('머리말·화면 맞춤 판정·키', () => {
  it('식별자가 있는 대상만 화면 맞춤', () => {
    expect(isTailoredContext(focus('이슈', { issueKey: 'WP-1' }))).toBe(true);
    expect(isTailoredContext(focus('일정', {}))).toBe(false);
    expect(isTailoredContext(null)).toBe(false);
  });
  it('머리말', () => {
    expect(starterHeading(focus('이슈', { issueKey: 'WP-1' }))).toBe('이 이슈에 대해');
    expect(starterHeading(null)).toBe('추천 질문');
  });
  it('머리말은 고정 문구와 일치 — 일반 문구로 떨어지면 "추천 질문"', () => {
    // 표에 없는 대상 종류(식별자는 있음)
    expect(starterHeading(focus('프로젝트', { projectKey: 'WP' }))).toBe('추천 질문');
    // 구성원·외부 식별자가 모두 없는 연락처
    expect(starterHeading(focus('연락처', { other: 'x' }))).toBe('추천 질문');
    expect(fixedStarters(focus('연락처', { other: 'x' }))).toEqual(GENERAL_STARTERS);
    // 표에 있으면 맞춤 머리말
    expect(starterHeading(focus('연락처', { username: 'kim' }))).toBe('이 연락처에 대해');
  });
  it('키 — 화면 참고가 없으면 general, 있으면 화면 정체성(건수·facts 무시)', () => {
    expect(starterContextKey(null)).toBe('general');
    const a = { ...focus('이슈', { issueKey: 'WP-1' }), scope: { label: 'P', count: 1 } };
    const b = { ...focus('이슈', { issueKey: 'WP-1' }), scope: { label: 'P', count: 9 } };
    expect(starterContextKey(a)).toBe(starterContextKey(b));
  });
});

describe('settleStarterView — 교체 보류', () => {
  const view: StarterView = { key: 'k', shown: ['고정'], incoming: { key: 'k', items: ['AI'] } };
  it('보류 중이면 그대로', () => {
    expect(settleStarterView(view, true)).toBe(view);
  });
  it('보류가 풀리면 한 번 교체', () => {
    expect(settleStarterView(view, false)).toEqual({ key: 'k', shown: ['AI'], incoming: null });
  });
  it('다른 대상의 늦은 결과는 버린다', () => {
    expect(settleStarterView({ ...view, incoming: { key: 'old', items: ['X'] } }, false)).toEqual({ key: 'k', shown: ['고정'], incoming: null });
  });
  it('들어온 결과가 없으면 같은 참조', () => {
    const idle = { key: 'k', shown: ['고정'], incoming: null };
    expect(settleStarterView(idle, false)).toBe(idle);
  });
});
