import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serializeSubagent, writeSubagentDefinitions, loadSubagents, type SubagentDefinition } from './subagent-loader.js';

const issueDef: SubagentDefinition = {
  description: '이슈 조회·상태변경·코멘트',
  tools: ['mcp__workplace__get_issue_detail', 'mcp__workplace__update_status'],
  maxTurns: 20,
  prompt: '# 역할\n이슈 전문가입니다.\n',
};

describe('serializeSubagent', () => {
  it('frontmatter(name/description/tools/maxTurns) + body 를 직렬화', () => {
    const md = serializeSubagent('issue-agent', issueDef);
    expect(md).toContain('---\nname: issue-agent\n');
    expect(md).toContain('description: "이슈 조회·상태변경·코멘트"');
    expect(md).toContain('tools:\n  - mcp__workplace__get_issue_detail\n  - mcp__workplace__update_status');
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
