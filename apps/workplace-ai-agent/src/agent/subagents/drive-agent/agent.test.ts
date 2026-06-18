import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSubagents } from '../../subagent-loader.js';

const subagentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('drive-agent 정의', () => {
  const loaded = loadSubagents(subagentsDir);
  it('loadSubagents 로 drive-agent 가 로드된다', () => {
    expect(loaded['drive-agent']).toBeDefined();
  });
  it('tools 는 읽기 3개만(쓰기 없음 — v1)', () => {
    expect(loaded['drive-agent'].tools).toEqual([
      'mcp__workplace__list_drive_spaces',
      'mcp__workplace__list_drive_items',
      'mcp__workplace__search_drive',
    ]);
  });
  it('maxTurns 설정 + 본문에 드라이브·읽기 안내', () => {
    expect(loaded['drive-agent'].maxTurns).toBeGreaterThan(0);
    expect(loaded['drive-agent'].prompt).toMatch(/드라이브|파일/);
  });
});
