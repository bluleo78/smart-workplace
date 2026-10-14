import { describe, expect, it } from 'vitest';
import { buildSharedTools, type SharedToolClient } from './shared-tools.js';
import { isDisplayableTool, isMemoryTool, MEMORY_TOOL_NAMES, stripMcpPrefix, TOOL_LABELS } from './tool-labels.js';

// #879: 도구를 추가하고 라벨을 빠뜨리면 AI 채팅에 원래 도구 이름(update_issue 등)이 영어로 그대로 노출된다.
// ai-agent 로컬 도구의 라벨과 실존하지 않는 키 검사는 ai-agent tools.test.ts 가 맡는다(공유+로컬 전체를 거기서만 안다).
describe('TOOL_LABELS', () => {
  it('공유 도구 전부에 라벨이 있다', () => {
    const missing = buildSharedTools({} as unknown as SharedToolClient)
      .map((t) => t.name)
      .filter((n) => !TOOL_LABELS[n]);
    expect(missing).toEqual([]);
  });

  // WP-343: update_status(→ update_issue 의 status)·list_project_members(→ get_project.members)는 폐지 — 공유 도구·라벨 어디에도 없어야 한다.
  it('폐지된 update_status·list_project_members 는 공유 도구 목록과 라벨에 없다', () => {
    const names = buildSharedTools({} as unknown as SharedToolClient).map((t) => t.name);
    for (const removed of ['update_status', 'list_project_members']) {
      expect(names).not.toContain(removed);
      expect(TOOL_LABELS[removed]).toBeUndefined();
    }
  });

  // WP-360: 명명 규칙으로 바뀐 옛 이름은 공유 도구·라벨에 남기지 않는다(옛 세션 표시용 폴백은 웹 LEGACY_TOOL_LABELS).
  it('WP-360 에서 바뀐 옛 이름은 공유 도구 목록과 라벨에 없다', () => {
    const names = buildSharedTools({} as unknown as SharedToolClient).map((t) => t.name);
    for (const old of ['edit_comment', 'get_thread_replies', 'get_wiki_backlinks', 'get_chat_thread']) {
      expect(names).not.toContain(old);
      expect(TOOL_LABELS[old]).toBeUndefined();
    }
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

// WP-55: 메모리 도구는 결과 줄(🧠)로 따로 보이므로 숨김 도구다 — show_*·propose_* 처럼 라벨이 없다(ai-agent tools.test.ts 의 숨김 도구 무라벨 불변식).
describe('isMemoryTool (WP-55)', () => {
  it('세 메모리 도구를 런타임 접두와 무관하게 알아본다', () => {
    expect(MEMORY_TOOL_NAMES).toEqual(['remember_memory', 'update_memory', 'forget_memory']);
    for (const n of MEMORY_TOOL_NAMES) {
      expect(isMemoryTool(n)).toBe(true);
      expect(isMemoryTool(`mcp__workplace__${n}`)).toBe(true);
      expect(isMemoryTool(`workplace_${n}`)).toBe(true);
    }
    expect(isMemoryTool('update_issue')).toBe(false);
    expect(isMemoryTool('memory')).toBe(false);
  });

  it('숨김 도구이고 라벨이 없다', () => {
    for (const n of MEMORY_TOOL_NAMES) {
      expect(isDisplayableTool(n)).toBe(false);
      expect(isDisplayableTool(`mcp__workplace__${n}`)).toBe(false);
      expect(isDisplayableTool(`workplace_${n}`)).toBe(false);
      expect(TOOL_LABELS[n]).toBeUndefined();
    }
  });
});

// WP-383·384: 검색 도구는 메모리 저장 도구가 아니다 — 숨기지 않고 단계 목록에 라벨로 보인다(API isDisplayableTool 도 같은 규칙, 판정 13).
describe('검색 도구 라벨 (WP-383)', () => {
  it('search_memory 는 표시 대상이고 "메모리 찾기" 라벨이 있다', () => {
    expect(isMemoryTool('search_memory')).toBe(false);
    expect(isDisplayableTool('mcp__workplace__search_memory')).toBe(true);
    expect(TOOL_LABELS.search_memory).toEqual({ label: '메모리 찾기', icon: '🧠' });
  });

  it('search_conversations 는 표시 대상이고 "지난 대화 찾기" 라벨이 있다(WP-384)', () => {
    expect(isMemoryTool('search_conversations')).toBe(false);
    expect(isDisplayableTool('workplace_search_conversations')).toBe(true);
    expect(TOOL_LABELS.search_conversations).toEqual({ label: '지난 대화 찾기', icon: '💬' });
  });
});
