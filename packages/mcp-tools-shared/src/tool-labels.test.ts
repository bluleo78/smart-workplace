import { describe, expect, it } from 'vitest';
import { buildSharedTools, type SharedToolClient } from './shared-tools.js';
import { isDisplayableTool, stripMcpPrefix, TOOL_LABELS } from './tool-labels.js';

// #879: 도구를 추가하고 라벨을 빠뜨리면 AI 채팅에 원래 도구 이름(update_issue 등)이 영어로 그대로 노출된다.
// ai-agent 로컬 도구의 라벨과 실존하지 않는 키 검사는 ai-agent tools.test.ts 가 맡는다(공유+로컬 전체를 거기서만 안다).
describe('TOOL_LABELS', () => {
  it('공유 도구 전부에 라벨이 있다', () => {
    const missing = buildSharedTools({} as unknown as SharedToolClient)
      .map((t) => t.name)
      .filter((n) => !TOOL_LABELS[n]);
    expect(missing).toEqual([]);
  });
});

describe('stripMcpPrefix / isDisplayableTool', () => {
  it('Claude SDK(mcp__workplace__X)·opencode(workplace_X)·맨 이름을 같은 도구 이름으로 정규화한다', () => {
    expect(stripMcpPrefix('mcp__workplace__update_issue')).toBe('update_issue');
    expect(stripMcpPrefix('workplace_update_issue')).toBe('update_issue');
    expect(stripMcpPrefix('update_issue')).toBe('update_issue');
  });

  it('opencode 형식의 위젯·제안 도구도 숨긴다', () => {
    expect(isDisplayableTool('workplace_show_issue_list')).toBe(false);
    expect(isDisplayableTool('workplace_propose_create_issue')).toBe(false);
    expect(isDisplayableTool('mcp__workplace__submit_response')).toBe(false);
    expect(isDisplayableTool('workplace_update_issue')).toBe(true);
  });
});
