import { describe, expect, it } from 'vitest';

import { TOOL_LABELS } from '@smart-workplace/mcp-tools-shared/tool-labels';

import { getToolDisplay, LEGACY_TOOL_LABELS, widgetTypeFromToolName } from './aiToolLabels';

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
