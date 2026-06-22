import { describe, expect, it } from 'vitest';

import { widgetTypeFromToolName } from './aiToolLabels';

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
    expect(widgetTypeFromToolName('mcp__workplace__update_status')).toBeNull();
  });
});
