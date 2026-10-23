import { TOOL_LABELS } from '@smart-workplace/mcp-tools-shared/tool-labels';
import { describe, expect, it } from 'vitest';

import {
  formatPages,
  getToolDisplay,
  getToolStepDisplay,
  isVisibleStep,
  LEGACY_TOOL_LABELS,
  visibleSteps,
  widgetTypeFromToolName,
} from './aiToolLabels';

// #461: show_* 도구명 → 위젯 타입 추출(점진 렌더용). 백엔드 compose-parser 와 동일 규칙 검증.
describe('widgetTypeFromToolName', () => {
  it('mcp 프리픽스 있는 show_* → 위젯 타입', () => {
    expect(widgetTypeFromToolName('mcp__workplace__show_calendar')).toBe('calendar');
    expect(widgetTypeFromToolName('mcp__workplace__show_wiki_page')).toBe('wiki_page');
  });
  it('프리픽스 없는 show_* → 위젯 타입', () => {
    expect(widgetTypeFromToolName('show_mail_list')).toBe('mail_list');
  });
  it('show_ 가 아니면 null', () => {
    expect(widgetTypeFromToolName('list_events')).toBeNull();
    expect(widgetTypeFromToolName('mcp__workplace__respond_chat')).toBeNull();
    expect(widgetTypeFromToolName('mcp__workplace__update_issue')).toBeNull();
  });
});

// WP-340: 이름이 바뀐 도구의 옛 toolName(이전에 저장된 세션)도 한글 라벨로 보인다. 현재 이름은 영향 없다.
describe('getToolDisplay — 옛 도구 이름 폴백', () => {
  it('프로토타입 키는 모르는 도구처럼 원문 + 🔧 (WP-416)', () => {
    expect(getToolDisplay('constructor')).toEqual({ label: 'constructor', icon: '🔧' });
    expect(getToolDisplay('mcp__workplace__toString')).toEqual({ label: 'toString', icon: '🔧' });
  });

  it('옛 이름은 한글 라벨과 아이콘을 돌려준다(mcp 프리픽스 포함)', () => {
    expect(getToolDisplay('update_status')).toEqual({ label: '상태 변경', icon: '✏️' });
    expect(getToolDisplay('mcp__workplace__list_project_members')).toEqual({ label: '멤버 조회', icon: '👥' });
    expect(getToolDisplay('create_folder').label).toBe('폴더 생성');
    expect(getToolDisplay('rename_folder').label).toBe('폴더 이름변경');
    expect(getToolDisplay('move_folder').label).toBe('폴더 이동');
    expect(getToolDisplay('move_file').label).toBe('파일 이동');
    // WP-360: 명명 규칙으로 바뀐 이름
    expect(getToolDisplay('edit_comment')).toEqual({ label: '코멘트 수정', icon: '✏️' });
    expect(getToolDisplay('mcp__workplace__get_thread_replies').label).toBe('스레드 답글 조회');
    expect(getToolDisplay('get_wiki_backlinks').label).toBe('노트 백링크 조회');
    expect(getToolDisplay('get_chat_thread').label).toBe('대화 조회');
    // WP-352: get_channel_messages → list_channel_messages
    expect(getToolDisplay('mcp__workplace__get_channel_messages')).toEqual({ label: '채널 메시지 조회', icon: '💬' });
    // WP-355: discover_channels 는 list_channels 의 q 옵션으로 접혀 옛 이름이 LEGACY 에 남았다(기록 표시용)
    expect(getToolDisplay('mcp__workplace__discover_channels')).toEqual({ label: '채널 탐색', icon: '🔍' });
    // WP-346: 이슈 챗 첨부 읽기(opencode 형식 접두 포함)
    expect(getToolDisplay('workplace_read_attachment_text')).toEqual({ label: '첨부 읽기', icon: '📎' });
    expect(getToolDisplay('read_chat_thread_attachment').label).toBe('첨부 읽기');
    // WP-369: read_attachment → read_file, 드라이브 이름변경·이동 통합 — 옛 이름은 LEGACY 폴백, 새 이름은 공유 TOOL_LABELS.
    expect(getToolDisplay('mcp__workplace__read_attachment').label).toBe('첨부·파일 읽기');
    expect(getToolDisplay('mcp__workplace__read_file')).toEqual(TOOL_LABELS.read_file);
    expect(getToolDisplay('read_file').label).toBe('파일 읽기');
    expect(getToolDisplay('rename_drive_folder').label).toBe('폴더 이름변경');
    expect(getToolDisplay('mcp__workplace__rename_drive_file').label).toBe('파일 이름변경');
    expect(getToolDisplay('move_drive_folder').label).toBe('폴더 이동');
    expect(getToolDisplay('workplace_move_drive_file').label).toBe('파일 이동');
    expect(getToolDisplay('rename_drive_item')).toEqual(TOOL_LABELS.rename_drive_item);
    expect(getToolDisplay('move_drive_item')).toEqual(TOOL_LABELS.move_drive_item);
    // WP-421: 구독·리액션 도구를 하나씩으로 합침 — 옛 이름은 LEGACY 폴백(옛 라벨 그대로), 새 이름은 공유 TOOL_LABELS.
    expect(getToolDisplay('mcp__workplace__unwatch_issue')).toEqual({ label: '이슈 구독 해제', icon: '👀' });
    expect(getToolDisplay('add_reaction')).toEqual({ label: '리액션 추가', icon: '👍' });
    expect(getToolDisplay('remove_reaction')).toEqual({ label: '리액션 제거', icon: '👍' });
    expect(getToolDisplay('watch_issue')).toEqual(TOOL_LABELS.watch_issue);
    // WP-812: react_to_message → react(코멘트 반응까지), 의존관계 추가·제거 → link_issues — 옛 이름은 LEGACY 폴백(옛 라벨 그대로).
    expect(getToolDisplay('react')).toEqual(TOOL_LABELS.react);
    expect(getToolDisplay('react_to_message')).toEqual({ label: '리액션', icon: '👍' });
    expect(getToolDisplay('link_issues')).toEqual(TOOL_LABELS.link_issues);
    expect(getToolDisplay('mcp__workplace__add_issue_dependency')).toEqual({ label: '이슈 의존관계 추가', icon: '🔗' });
    expect(getToolDisplay('remove_issue_dependency')).toEqual({ label: '이슈 의존관계 제거', icon: '🔗' });
    expect(getToolDisplay('upload_file')).toEqual({ label: '파일 올리기', icon: '📤' });
    // 새 이름은 공유 TOOL_LABELS 에서 같은 라벨을 쓴다.
    expect(getToolDisplay('update_comment').label).toBe('코멘트 수정');
    expect(getToolDisplay('list_thread_replies').label).toBe('스레드 답글 조회');
    expect(getToolDisplay('list_channel_messages')).toEqual(TOOL_LABELS.list_channel_messages);
  });
  it('현재 이름은 공유 TOOL_LABELS 라벨을 그대로 쓴다', () => {
    expect(getToolDisplay('update_issue')).toEqual(TOOL_LABELS.update_issue);
  });
  it('검색 도구는 "메모리 찾기"·"지난 대화 찾기"로 보인다 (WP-383·WP-384)', () => {
    expect(getToolDisplay('search_memory').label).toBe('메모리 찾기');
    expect(getToolDisplay('mcp__workplace__search_conversations').label).toBe('지난 대화 찾기');
  });
  it('모르는 이름은 원래 이름 + 🔧', () => {
    expect(getToolDisplay('mcp__workplace__no_such_tool')).toEqual({ label: 'no_such_tool', icon: '🔧' });
  });
  it('옛 이름은 공유 TOOL_LABELS 에 없다(폴백 전용)', () => {
    for (const k of Object.keys(LEGACY_TOOL_LABELS)) expect(TOOL_LABELS[k]).toBeUndefined();
  });
});

// WP-250: AI 가 PDF 페이지를 이미지로 본 도구 단계는 "📄 페이지 보기 7쪽" 으로 보인다.
describe('formatPages', () => {
  it('한 쪽 · 연속 구간(en dash) · 흩어진 쪽(가운뎃점)', () => {
    expect(formatPages([7])).toBe('7쪽');
    expect(formatPages([11, 12, 13])).toBe('11–13쪽');
    expect(formatPages([2, 5])).toBe('2·5쪽');
  });
  it('순서·중복과 상관없이 정렬·중복 제거해 보인다', () => {
    expect(formatPages([13, 12, 11])).toBe('11–13쪽');
    expect(formatPages([7, 7])).toBe('7쪽');
    expect(formatPages([5, 2])).toBe('2·5쪽');
    expect(formatPages([3, 1, 2, 2])).toBe('1–3쪽');
  });
  it('배열이 아니거나 비었거나 숫자가 아니면 null', () => {
    expect(formatPages(undefined)).toBeNull();
    expect(formatPages('7')).toBeNull();
    expect(formatPages([])).toBeNull();
    expect(formatPages(['7'])).toBeNull();
    expect(formatPages([7, NaN])).toBeNull();
  });
});

describe('getToolStepDisplay', () => {
  it('pages 가 있으면 페이지 보기 라벨(mcp 프리픽스 포함)', () => {
    expect(getToolStepDisplay('mcp__workplace__read_chat_attachment', { fileId: 1, pages: [7] })).toEqual({
      label: '페이지 보기',
      icon: '📄',
      detail: '7쪽',
    });
  });
  it('pages 가 없으면 기존 라벨·detail 그대로', () => {
    expect(getToolStepDisplay('read_file', { source: 'drive', driveFileId: 3 })).toEqual({
      label: '파일 읽기',
      icon: '📎',
      detail: null,
    });
    expect(getToolStepDisplay('read_chat_attachment', { fileId: 41 }).label).toBe('첨부 읽기');
  });
  it('pages 가 비정상이면 기존 라벨로 폴백', () => {
    expect(getToolStepDisplay('read_file', { pages: [] }).label).toBe('파일 읽기');
  });
  it('메일 첨부(read_file source mail)는 pages 가 있어도 페이지 보기가 아니다(메일은 미지원)', () => {
    expect(getToolStepDisplay('mcp__workplace__read_file', { source: 'mail', attachmentId: 3, pages: [2] })).toEqual({
      label: '파일 읽기',
      icon: '📎',
      detail: null,
    });
    expect(getToolStepDisplay('read_file', { source: 'drive', driveFileId: 3, pages: [2] }).label).toBe('페이지 보기');
  });
  it('접두(mcp__workplace__·opencode workplace_)가 붙은 신규 도구도 원래 이름이 아닌 한국어 라벨 + detail 로 보인다 (#879)', () => {
    expect(getToolStepDisplay('mcp__workplace__search_members', { query: '민수' })).toEqual({
      label: '구성원 검색',
      icon: '👥',
      detail: '민수',
    });
    expect(getToolStepDisplay('workplace_update_issue', { issueKey: 'WP-77' })).toEqual({
      label: '이슈 수정',
      icon: '✏️',
      detail: 'WP-77',
    });
  });
  it('pages 를 받는 도구가 아니면 pages 가 있어도 기존 라벨', () => {
    expect(getToolStepDisplay('update_issue', { issueKey: 'EX-1', pages: [3] }).label).toBe('이슈 수정');
  });
});

// 도구 단계 표시 필터(WP-412 — ai-chat-tool-steps E2E 에서 이관). 위젯 렌더용 show_* 와 응답 전달용 respond_chat 은
// 사용자에게 보일 "작업"이 아니라 숨기고, 위임(delegation) 단계는 항상 보인다.
describe('isVisibleStep / visibleSteps', () => {
  it('show_*·respond_chat 은 숨기고 일반 도구·위임은 남긴다', () => {
    const steps = [
      { kind: 'tool' as const, seq: 3, toolName: 'show_issue_list' },
      { kind: 'tool' as const, seq: 4, toolName: 'respond_chat' },
      { kind: 'tool' as const, seq: 5, toolName: 'add_comment' },
      { kind: 'delegation' as const, label: '이슈 에이전트' },
    ];
    expect(visibleSteps(steps).map((s) => s.toolName ?? s.label)).toEqual(['add_comment', '이슈 에이전트']);
  });

  it('접두가 붙은 숨김 도구도 숨긴다', () => {
    expect(isVisibleStep({ kind: 'tool', toolName: 'mcp__workplace__show_issue_list' })).toBe(false);
    expect(isVisibleStep({ kind: 'tool', toolName: 'mcp__workplace__add_comment' })).toBe(true);
  });
});
