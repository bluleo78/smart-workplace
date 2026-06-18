import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSubagents } from '../../subagent-loader.js';

const subagentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('mail-agent 정의', () => {
  const loaded = loadSubagents(subagentsDir);
  it('loadSubagents 로 mail-agent 가 로드된다', () => {
    expect(loaded['mail-agent']).toBeDefined();
  });
  it('tools 는 읽기(list/get) + 발송 제안(propose_send_mail) + 계정 목록/동기화(list_mail_accounts/sync_mail)', () => {
    expect(loaded['mail-agent'].tools).toEqual([
      'mcp__workplace__list_mail',
      'mcp__workplace__get_mail',
      'mcp__workplace__propose_send_mail',
      'mcp__workplace__list_mail_accounts',
      'mcp__workplace__sync_mail',
    ]);
  });
  it('maxTurns 설정 + 본문에 메일·발송 확인 안내', () => {
    expect(loaded['mail-agent'].maxTurns).toBeGreaterThan(0);
    expect(loaded['mail-agent'].prompt).toMatch(/메일|발송/);
  });
});
