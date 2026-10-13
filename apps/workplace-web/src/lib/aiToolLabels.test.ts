import { TOOL_LABELS } from '@smart-workplace/mcp-tools-shared/tool-labels';
import { describe, expect, it } from 'vitest';

import { getToolDisplay, isVisibleStep, LEGACY_TOOL_LABELS, widgetTypeFromToolName } from './aiToolLabels';

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
    // 새 이름은 공유 TOOL_LABELS 에서 같은 라벨을 쓴다.
    expect(getToolDisplay('update_comment').label).toBe('코멘트 수정');
    expect(getToolDisplay('list_thread_replies').label).toBe('스레드 답글 조회');
    expect(getToolDisplay('list_channel_messages')).toEqual(TOOL_LABELS.list_channel_messages);
  });
  it('현재 이름은 공유 TOOL_LABELS 라벨을 그대로 쓴다', () => {
    expect(getToolDisplay('update_issue')).toEqual(TOOL_LABELS.update_issue);
  });
  it('모르는 이름은 원래 이름 + 🔧', () => {
    expect(getToolDisplay('mcp__workplace__no_such_tool')).toEqual({ label: 'no_such_tool', icon: '🔧' });
  });
  it('옛 이름은 공유 TOOL_LABELS 에 없다(폴백 전용)', () => {
    for (const k of Object.keys(LEGACY_TOOL_LABELS)) expect(TOOL_LABELS[k]).toBeUndefined();
  });
});

// WP-55: 메모리 도구는 결과 줄로 보이므로 도구 단계 목록에서 숨긴다(라벨은 공유 표에 있다).
describe('isVisibleStep — 메모리 도구 (WP-55)', () => {
  it('세 메모리 도구는 런타임 접두와 무관하게 숨기고, 다른 도구는 그대로', () => {
    for (const n of ['remember_memory', 'mcp__workplace__update_memory', 'workplace_forget_memory']) {
      expect(isVisibleStep({ kind: 'tool', toolName: n })).toBe(false);
    }
    expect(isVisibleStep({ kind: 'tool', toolName: 'update_issue' })).toBe(true);
  });
});
