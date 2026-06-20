import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSubagents } from '../../subagent-loader.js';

const subagentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('project-agent 정의', () => {
  const loaded = loadSubagents(subagentsDir);
  it('loadSubagents 로 project-agent 가 로드된다', () => {
    expect(loaded['project-agent']).toBeDefined();
  });
  it('tools 는 read 3 + propose 3', () => {
    expect(loaded['project-agent'].tools).toEqual([
      'mcp__workplace__list_projects',
      'mcp__workplace__get_project',
      'mcp__workplace__list_project_members',
      'mcp__workplace__propose_create_project',
      'mcp__workplace__propose_delete_project',
      'mcp__workplace__propose_add_project_member',
    ]);
  });
  it('maxTurns 설정 + 본문에 프로젝트·제안 안내', () => {
    expect(loaded['project-agent'].maxTurns).toBeGreaterThan(0);
    expect(loaded['project-agent'].prompt).toMatch(/프로젝트|제안/);
  });
  it('워크플로우에 존재 확인(get_project) 규칙이 명시되어 있다', () => {
    // 멤버 추가 propose 전 get_project 존재 확인 규칙 (#386)
    expect(loaded['project-agent'].prompt).toMatch(/get_project/);
    expect(loaded['project-agent'].prompt).toMatch(/존재/);
  });
  it('규칙 위반 key 를 수락하지 말고 변환·안내하라는 규칙이 명시되어 있다', () => {
    // #387: 소문자 등 ^[A-Z][A-Z0-9]{1,9}$ 위반 key 를 그대로 수락 금지 + 대문자 변환/되묻기.
    const prompt = loaded['project-agent'].prompt;
    expect(prompt).toMatch(/\^\[A-Z]\[A-Z0-9]\{1,9}\$/);
    expect(prompt).toMatch(/수락하지 마|수락 금지|그대로 수락/);
    expect(prompt).toMatch(/ABC/); // abc → ABC 변환 예시
  });
});
