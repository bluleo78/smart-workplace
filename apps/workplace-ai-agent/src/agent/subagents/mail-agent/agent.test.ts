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
  it('tools 는 읽기(list/get/요약) + 답장 초안 + 발송 제안 + 계정 목록/동기화 + 읽음 처리·이슈 전환', () => {
    expect(loaded['mail-agent'].tools).toEqual([
      'mcp__workplace__list_mail',
      'mcp__workplace__get_mail',
      'mcp__workplace__read_file', // WP-358: 메일 첨부 읽기(첫 호출 PENDING)
      // #855: AI 요약·답장 초안(저장·발송 없음)
      'mcp__workplace__get_mail_summary',
      'mcp__workplace__draft_mail_reply',
      'mcp__workplace__propose_send_mail',
      'mcp__workplace__list_mail_accounts',
      'mcp__workplace__sync_mail',
      // #855 · WP-146: 읽음 처리 + 메일→이슈 초안·생성
      'mcp__workplace__mark_mail_read',
      'mcp__workplace__draft_issue_from_mail',
      'mcp__workplace__create_issue_from_mail',
      // WP-351: 담당자가 프로젝트 멤버인지 미리 확인(get_project.members)
      'mcp__workplace__get_project',
      // #844: 참석자·수신자 이메일 조달 — 구성원 + 외부 연락처
      'mcp__workplace__search_members',
      'mcp__workplace__list_contacts',
      'mcp__workplace__submit_response',
    ]);
  });
  it('WP-356: create_issue_from_mail 의 유형·라벨(get_project 의 이름)을 안내한다', () => {
    const prompt = loaded['mail-agent'].prompt;
    expect(prompt).toContain('type?, labels?');
    expect(prompt).toContain('`issueTypes`·`labels`');
  });
  // WP-357: 분류·회신 필요 필터, 안 읽음 되돌리기(read=false), 메일에 연결된 이슈(issueKey).
  it('list_mail 의 category·needsReply, mark_mail_read 의 read=false(안 읽음), get_mail 의 issueKey 를 안내한다 (WP-357)', () => {
    const prompt = loaded['mail-agent'].prompt;
    expect(prompt).toContain('unreadOnly?, category?, needsReply?, limit?');
    expect(prompt).toContain('`needsReply=true`');
    expect(prompt).toContain('mark_mail_read(messageId, read?)');
    expect(prompt).toContain('`read=false`');
    expect(prompt).toContain('`issueKey`');
    // 예전의 "안 읽음으로 되돌릴 수 없다" 안내가 남아 있으면 모델이 도구가 있어도 거절한다.
    expect(prompt).not.toContain('되돌릴 수 없어');
  });
  it('maxTurns 설정 + 본문에 메일·발송 확인 안내', () => {
    expect(loaded['mail-agent'].maxTurns).toBeGreaterThan(0);
    expect(loaded['mail-agent'].prompt).toMatch(/메일|발송/);
  });

  // WP-353: sync_mail 은 서버 건수를 돌려주고 이미 동기화 중이면 그 사실을 알린다. get_mail 본문은 bodyText 하나다.
  it('sync_mail 결과(saved·seenChanged·alreadySyncing)와 get_mail 평문 본문을 안내한다', () => {
    const prompt = loaded['mail-agent'].prompt;
    expect(prompt).toContain('{fetched, saved, seenChanged}');
    expect(prompt).toContain('alreadySyncing');
    expect(prompt).toContain('`bodyText`');
    expect(prompt).not.toContain('완료 응답만으로');
  });

  // WP-358: 메일 첨부는 첫 호출이 PENDING 이라 다시 부르라고 안내한다. 요약·답장 초안은 첨부를 읽지 않는다.
  it('read_file 을 source "mail" + attachmentId(get_mail)로 안내하고 PENDING 재호출·추측 금지를 밝힌다 (WP-358)', () => {
    const prompt = loaded['mail-agent'].prompt;
    expect(prompt).toContain('read_file(source="mail", attachmentId, offset?, limit?)');
    expect(prompt).toContain('`attachments[].attachmentId`');
    expect(prompt).toContain('첫 호출은 `PENDING`');
    expect(prompt).toContain('내용을 추측하지 말고');
  });
});
