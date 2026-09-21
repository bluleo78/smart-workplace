import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSubagents } from '../../subagent-loader.js';

const subagentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('member-agent 정의 (#833)', () => {
  const loaded = loadSubagents(subagentsDir);

  it('loadSubagents 로 member-agent 가 로드된다', () => {
    expect(loaded['member-agent']).toBeDefined();
  });

  it('tools 는 구성원 읽기 3 + 쓰기 제안 2 + submit_response', () => {
    expect(loaded['member-agent'].tools).toEqual([
      'mcp__workplace__search_members',
      'mcp__workplace__get_member',
      'mcp__workplace__get_member_contact',
      'mcp__workplace__propose_set_member_role',
      'mcp__workplace__propose_set_member_active',
      'mcp__workplace__submit_response',
    ]);
  });

  it('연락처 도구를 갖지 않는다 — 외부 연락처는 contacts-agent 담당', () => {
    const tools = loaded['member-agent'].tools ?? [];
    expect(tools.some((t) => t.includes('list_contacts'))).toBe(false);
    expect(tools.some((t) => t.includes('external_contact'))).toBe(false);
  });

  it('사람은 username 으로 가리킨다는 규칙이 프롬프트에 명시된다', () => {
    // #833: 숫자 id 를 LLM 표면에서 없앤 것이 이 변경의 핵심이다 — 프롬프트도 같은 계약을 가르쳐야 한다.
    const prompt = loaded['member-agent'].prompt;
    expect(prompt).toMatch(/username/);
    expect(prompt).toMatch(/숫자 id 를 직접 다루지 않습니다/);
  });

  it('계정 생성은 도구가 없다는 안내가 있다 — 초기 비밀번호를 에이전트가 정하지 않기 위함', () => {
    expect(loaded['member-agent'].prompt).toMatch(/계정 생성/);
  });
});
