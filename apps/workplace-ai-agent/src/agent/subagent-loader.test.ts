import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  serializeSubagent, writeSubagentDefinitions, loadSubagents, toAgentDefinitions, toRouterAgentDefinition, type SubagentDefinition,
} from './subagent-loader.js';
import { MEMORY_TOOL_NAMES } from '@smart-workplace/mcp-tools-shared';
import { ASSISTANT_ROUTER_TOOLS, buildTools } from '../mcp/tools.js';

const issueDef: SubagentDefinition = {
  description: '이슈 조회·상태변경·코멘트',
  tools: ['mcp__workplace__get_issue_detail', 'mcp__workplace__update_issue'],
  maxTurns: 20,
  prompt: '# 역할\n이슈 전문가입니다.\n',
};

describe('serializeSubagent', () => {
  it('frontmatter(name/description/tools/maxTurns) + body 를 직렬화', () => {
    const md = serializeSubagent('issue-agent', issueDef);
    expect(md).toContain('---\nname: issue-agent\n');
    expect(md).toContain('description: "이슈 조회·상태변경·코멘트"');
    expect(md).toContain('tools:\n  - mcp__workplace__get_issue_detail\n  - mcp__workplace__update_issue');
    expect(md).toContain('maxTurns: 20');
    expect(md.endsWith('# 역할\n이슈 전문가입니다.\n')).toBe(true);
  });

  it('description 의 따옴표·백슬래시·줄바꿈을 YAML double-quoted 로 이스케이프', () => {
    const md = serializeSubagent('x', { description: 'a"b\\c\nd', tools: [], prompt: '' });
    expect(md).toContain('description: "a\\"b\\\\c\\nd"');
  });

  it('model=inherit 는 frontmatter 에 쓰지 않는다', () => {
    const md = serializeSubagent('x', { description: 'd', tools: [], model: 'inherit', prompt: '' });
    expect(md).not.toContain('model:');
  });

  // Finding 3: 빈 tools 배열도 'tools: []' 를 방출해 기본 도구 상속 구멍을 막는다.
  it('tools=[] 이면 "tools: []" 인라인 시퀀스를 방출한다', () => {
    const md = serializeSubagent('x', { description: 'd', tools: [], prompt: '' });
    expect(md).toContain('tools: []');
  });
});

describe('writeSubagentDefinitions', () => {
  it('<workDir>/.claude/agents/<name>.md 로 기록하고 stale .md 를 먼저 정리', () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'sa-test-'));
    try {
      const agentsDir = path.join(workDir, '.claude', 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(path.join(agentsDir, 'stale.md'), 'old', 'utf8'); // 이전 호출 잔여
      writeSubagentDefinitions(workDir, { 'issue-agent': issueDef });
      const files = readdirSync(agentsDir).sort();
      expect(files).toEqual(['issue-agent.md']); // stale.md 제거됨
      const md = readFileSync(path.join(agentsDir, 'issue-agent.md'), 'utf8');
      expect(md).toContain('name: issue-agent');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

describe('loadSubagents', () => {
  it('<dir>/<name>/agent.md 의 frontmatter+body 를 SubagentDefinition 으로 로드', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sa-load-'));
    try {
      const dir = path.join(root, 'issue-agent');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, 'agent.md'),
        ['---', 'name: issue-agent', 'description: "이슈 전문가"', 'tools:', '  - mcp__workplace__get_issue_detail', 'maxTurns: 20', '---', '', '# 역할\n본문입니다.'].join('\n'),
        'utf8',
      );
      const loaded = loadSubagents(root);
      expect(Object.keys(loaded)).toEqual(['issue-agent']);
      expect(loaded['issue-agent'].description).toBe('이슈 전문가');
      expect(loaded['issue-agent'].tools).toEqual(['mcp__workplace__get_issue_detail']);
      expect(loaded['issue-agent'].maxTurns).toBe(20);
      expect(loaded['issue-agent'].prompt).toContain('# 역할');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('agent.md 없는 디렉터리는 건너뛴다', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sa-skip-'));
    try {
      mkdirSync(path.join(root, 'empty'), { recursive: true });
      expect(loadSubagents(root)).toEqual({});
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Finding 3: tools=[] 라운드트립 — serializeSubagent → loadSubagents 가 빈 배열 반환.
  it('tools=[] 의 serializeSubagent→loadSubagents 라운드트립', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sa-empty-tools-'));
    try {
      const def: SubagentDefinition = { description: '테스트', tools: [], prompt: '# body\n' };
      const agentDir = path.join(root, 'empty-tools-agent');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(path.join(agentDir, 'agent.md'), serializeSubagent('empty-tools-agent', def), 'utf8');
      const loaded = loadSubagents(root);
      expect(loaded['empty-tools-agent'].tools).toEqual([]); // 빈 배열로 복원돼야 한다
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // 회귀 테스트: 백슬래시+따옴표 인접 값의 serialize→load 라운드트립 검증.
  // 구버전 멀티-패스 unescape(\"→" 먼저, \\→\ 나중)는 \\\" 를 잘못 디코딩한다.
  it('백슬래시+따옴표 인접 description 의 serializeSubagent→loadSubagents 라운드트립', () => {
    // JS 문자열 값: C:\path "q" end  (백슬래시와 따옴표가 인접)
    const original = 'C:\\path "q" end';
    const root = mkdtempSync(path.join(tmpdir(), 'sa-rt-'));
    try {
      const def: SubagentDefinition = { description: original, tools: [], prompt: '# body\n' };
      const agentDir = path.join(root, 'rt-agent');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(path.join(agentDir, 'agent.md'), serializeSubagent('rt-agent', def), 'utf8');
      const loaded = loadSubagents(root);
      expect(loaded['rt-agent'].description).toBe(original);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('toAgentDefinitions (#462 슬라이스4)', () => {
  it('SubagentDefinition → AgentDefinition(mcpServers:[workplace], prompt=본문)', () => {
    const out = toAgentDefinitions({
      'issue-agent': { description: '이슈', tools: ['mcp__workplace__list_issues'], maxTurns: 20, model: 'inherit', prompt: '역할...' },
    });
    expect(out['issue-agent']).toEqual({
      description: '이슈',
      prompt: '역할...',
      tools: ['mcp__workplace__list_issues'],
      mcpServers: ['workplace'],
      maxTurns: 20,
      model: 'inherit',
    });
  });

  it('WP-55: promptSuffix 를 모든 서브에이전트 prompt 끝에 덧붙인다(생략 시 그대로)', () => {
    const defs = { a: { description: 'd', tools: [], prompt: 'p' }, b: { description: 'e', tools: [], prompt: 'q' } };
    const out = toAgentDefinitions(defs, '\n\n## 사용자 메모리\n- x');
    expect(out.a.prompt).toBe('p\n\n## 사용자 메모리\n- x');
    expect(out.b.prompt).toBe('q\n\n## 사용자 메모리\n- x');
    expect(toAgentDefinitions(defs).a.prompt).toBe('p');
  });

  it('model 미지정 시 model 키 생략', () => {
    const out = toAgentDefinitions({ 'a': { description: 'd', tools: [], prompt: 'p' } });
    expect(out['a']).toEqual({ description: 'd', prompt: 'p', tools: [], mcpServers: ['workplace'] });
    expect('model' in out['a']).toBe(false);
    expect('maxTurns' in out['a']).toBe(false);
  });
});

describe('toRouterAgentDefinition (WP-351)', () => {
  it('라우터 도구에 mcp__workplace__ 접두사를 붙이고, 위임은 우리 서브에이전트만 Agent(…) 로 허용한다(prompt·model 은 그대로)', () => {
    const def = toRouterAgentDefinition(['list_issues', 'show_drive'], {
      prompt: 'sys', model: 'm', subagents: ['issue-agent', 'mail-agent'],
    });
    expect(def).toEqual({
      description: expect.any(String),
      prompt: 'sys',
      model: 'm',
      tools: ['mcp__workplace__list_issues', 'mcp__workplace__show_drive', 'Agent(issue-agent, mail-agent)'],
    });
    // 그냥 Agent 면 내장 에이전트(general-purpose 등)로 서브에이전트 경계를 우회한다
    expect(def.tools).not.toContain('Agent');
  });

  it('allowFileRead 면 Read 도 싣고, 서브에이전트가 없으면 위임 도구를 싣지 않는다', () => {
    expect(toRouterAgentDefinition([], { prompt: 'p', model: 'm', subagents: [], allowFileRead: true }).tools).toEqual(['Read']);
  });
});

// #844·WP-351: 서브에이전트는 메인 스레드와 같은 인-프로세스 MCP 서버(assistant 프로필)를 쓰고, SDK 는 서브에이전트 도구를
// 그 서버 전체에서 고른다. 그래서 서버(assistant 프로필)는 전 도구 union 을 유지하고 라우터만 ASSISTANT_ROUTER_TOOLS 로 좁힌다.
// allowlist 가 서버에 없는 도구를 가리키면 그 도구는 조용히 도달 불가가 된다.
// (에이전트별 도구 목록 자체는 각 subagents/<name>/agent.test.ts 가 고정한다.)
describe('실제 서브에이전트 allowlist (#844)', () => {
  const defs = loadSubagents();
  // #846: buildTools 가 구성 시점에 toolClient() 를 부르므로 그것만 둔 스텁(핸들러는 실행하지 않음).
  const assistantNames = buildTools({ toolClient: () => ({}) } as never, 1, 'assistant').map((t) => t.name);
  const assistantTools = new Set(assistantNames.map((n) => `mcp__workplace__${n}`));
  const subagentTools = new Set(Object.values(defs).flatMap((d) => d.tools));

  it('frontmatter 의 모든 도구는 assistant 프로파일(공유 MCP 서버)에 실제로 존재한다', () => {
    for (const [name, d] of Object.entries(defs)) {
      for (const tool of d.tools) expect(assistantTools.has(tool), `${name}: ${tool}`).toBe(true);
    }
  });

  it('WP-351: 라우터 도구는 모두 assistant 프로파일에 있다', () => {
    for (const n of ASSISTANT_ROUTER_TOOLS) expect(assistantNames, n).toContain(n);
  });

  it('WP-351: assistant 프로파일의 도구는 라우터나 어느 서브에이전트에서든 닿는다(도달 불가 도구 없음)', () => {
    const router = new Set(ASSISTANT_ROUTER_TOOLS);
    const unreachable = assistantNames.filter((n) => !router.has(n) && !subagentTools.has(`mcp__workplace__${n}`));
    expect(unreachable).toEqual([]);
  });

  // WP-55: 메모리는 라우터가 직접 저장한다(하위 에이전트는 이전 대화를 못 본다) — 어느 서브에이전트 frontmatter 에도 두지 않는다.
  it('WP-55: 메모리 도구는 라우터에만 있고 어느 서브에이전트에도 없다', () => {
    for (const n of MEMORY_TOOL_NAMES) {
      expect(ASSISTANT_ROUTER_TOOLS, n).toContain(n);
      expect(subagentTools.has(`mcp__workplace__${n}`), n).toBe(false);
    }
  });

  it('WP-383·384: 검색 도구(search_memory·search_conversations)는 라우터에만 있고 어느 서브에이전트에도 없다', () => {
    for (const n of ['search_memory', 'search_conversations']) {
      expect(ASSISTANT_ROUTER_TOOLS, n).toContain(n);
      expect(subagentTools.has(`mcp__workplace__${n}`), n).toBe(false);
    }
  });
});
