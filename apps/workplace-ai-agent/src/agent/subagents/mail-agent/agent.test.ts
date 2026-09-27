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
  it('tools 는 읽기(list/get/요약) + 답장 초안 + 발송 제안 + 계정 목록/동기화 + 회신완료·이슈 전환', () => {
    expect(loaded['mail-agent'].tools).toEqual([
      'mcp__workplace__list_mail',
      'mcp__workplace__get_mail',
      // #855: AI 요약·답장 초안(저장·발송 없음)
      'mcp__workplace__get_mail_summary',
      'mcp__workplace__draft_mail_reply',
      'mcp__workplace__propose_send_mail',
      'mcp__workplace__list_mail_accounts',
      'mcp__workplace__sync_mail',
      // #855: 회신 완료 처리 + 메일→이슈 초안·생성
      'mcp__workplace__set_mail_needs_reply_done',
      'mcp__workplace__draft_issue_from_mail',
      'mcp__workplace__create_issue_from_mail',
      // #844: 참석자·수신자 이메일 조달 — 구성원 + 외부 연락처
      'mcp__workplace__search_members',
      'mcp__workplace__list_contacts',
      'mcp__workplace__submit_response',
    ]);
  });
  it('maxTurns 설정 + 본문에 메일·발송 확인 안내', () => {
    expect(loaded['mail-agent'].maxTurns).toBeGreaterThan(0);
    expect(loaded['mail-agent'].prompt).toMatch(/메일|발송/);
  });
});
