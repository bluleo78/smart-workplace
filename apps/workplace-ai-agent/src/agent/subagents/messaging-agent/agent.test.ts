import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSubagents } from '../../subagent-loader.js';

const subagentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('messaging-agent 정의', () => {
  const loaded = loadSubagents(subagentsDir);
  it('loadSubagents 로 messaging-agent 가 로드된다', () => {
    expect(loaded['messaging-agent']).toBeDefined();
  });
  it('tools 는 채널 읽기+쓰기만(propose 없음)', () => {
    expect(loaded['messaging-agent'].tools).toEqual([
      'mcp__workplace__get_channel_messages',
      'mcp__workplace__add_channel_message',
    ]);
  });
  it('maxTurns 설정 + 본문에 채널 안내', () => {
    expect(loaded['messaging-agent'].maxTurns).toBeGreaterThan(0);
    expect(loaded['messaging-agent'].prompt).toMatch(/채널|메시지/);
  });
});
