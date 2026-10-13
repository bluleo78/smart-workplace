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
  it('tools 는 채널 읽기+쓰기+목록/탐색+채널 생성·DM 열기·나가기 + 채널 초대 제안(#856)', () => {
    expect(loaded['messaging-agent'].tools).toEqual([
      'mcp__workplace__list_channel_messages',
      'mcp__workplace__list_thread_replies', // #850: 스레드 답글
      'mcp__workplace__add_channel_message',
      'mcp__workplace__list_channels', // WP-355: q 로 공개 채널 탐색(옛 discover_channels)
      'mcp__workplace__read_file', // WP-358: 메시지 첨부 읽기
      // #855: 채널 생성·DM 열기·공개 채널 나가기
      'mcp__workplace__create_channel',
      'mcp__workplace__open_dm',
      'mcp__workplace__leave_channel',
      // WP-355: 채널 참여·리액션·내 메시지 수정·읽음 처리(사용자 신원, 직접 실행)
      'mcp__workplace__join_channel',
      'mcp__workplace__add_reaction',
      'mcp__workplace__remove_reaction',
      'mcp__workplace__update_channel_message',
      'mcp__workplace__mark_channel_read',
      'mcp__workplace__propose_add_channel_member', // #856: 채널 초대 제안
      'mcp__workplace__propose_leave_channel', // #860: 비공개 채널 나가기 제안
      'mcp__workplace__search_members', // #844: 이름 → 멘션 userId
      'mcp__workplace__submit_response',
    ]);
  });
  it('maxTurns 설정 + 본문에 채널 안내', () => {
    expect(loaded['messaging-agent'].maxTurns).toBeGreaterThan(0);
    expect(loaded['messaging-agent'].prompt).toMatch(/채널|메시지/);
  });
  // WP-352: 이름이 list_channel_messages 로 바뀌었고, 더 오래된 메시지는 nextCursor 로 이어 읽을 수 있다.
  it('list_channel_messages 안내 — nextCursor 로 이어 읽거나 일부만 봤다고 밝히고, 옛 이름은 없다', () => {
    const prompt = loaded['messaging-agent'].prompt;
    expect(prompt).toContain('list_channel_messages');
    expect(prompt).not.toContain('get_channel_messages');
    expect(prompt).toContain('`nextCursor` 를 `cursor` 로 넘겨');
    expect(prompt).toContain('일부만 본 것임을 밝힙니다');
    expect(prompt).not.toContain('더 오래된 메시지는 가져올 수 없습니다');
  });

  // WP-352: 채널 목록이 잘리면 nextOffset 으로 이어 찾고, 목록에 없다고 단정하지 않게 한다.
  it('list_channels 의 hasMore·nextOffset 안내가 있다', () => {
    const prompt = loaded['messaging-agent'].prompt;
    expect(prompt).toContain('list_channels(q?, limit?, offset?)');
    expect(prompt).toContain('`nextOffset` 을 `offset` 으로 넘겨 이어 조회하세요');
    expect(prompt).toContain('목록에 없다고 단정하기 전에');
  });

  // WP-353: 채널 목록 항목의 식별자 이름이 channelId 다(예전엔 id) — 쓰기·조회 도구의 입력 이름과 같다.
  it('채널 목록의 식별자를 channelId 로 안내한다', () => {
    expect(loaded['messaging-agent'].prompt).toContain('(channelId·name·memberCount 포함, 이름순)');
  });

  // WP-353: 응답을 정리해 0·false·null 키가 생략되고 본문 멘션이 이름으로 풀린다 — 프롬프트가 그 규칙을 안내해야 오독하지 않는다.
  it('생략된 키 규칙(unreadCount)과 풀린 멘션 표기를 안내한다', () => {
    const prompt = loaded['messaging-agent'].prompt;
    expect(prompt).toContain('키가 없으면 0·false');
    expect(prompt).toContain('@이름(username)');
    expect(prompt).toContain('흉내 내지 않습니다');
  });

  // WP-355: 새 도구의 사용 규칙(내 메시지만·삭제 미지원·이모지 형식·읽음 범위·채널 멤버 보기)과 낡은 문구("다시 참여시키는 도구는 없다")가 프롬프트에 맞게 반영됐다.
  it('채널 참여·리액션·메시지 수정·읽음 처리·채널 멤버 보기 안내가 있고 낡은 재참여 문구는 없다', () => {
    const prompt = loaded['messaging-agent'].prompt;
    expect(prompt).toContain('join_channel(channelId)');
    expect(prompt).toContain('내가 쓴 메시지만');
    expect(prompt).toContain('메시지 삭제는 지원하지 않습니다');
    expect(prompt).toContain('유니코드 이모지 문자 하나');
    expect(prompt).toContain('`hasUnreadThreads`');
    expect(prompt).toContain('search_members(channelId, search?)');
    expect(prompt).not.toContain('다시 참여시키는 도구는 없어');
  });

  // WP-355: discover_channels 는 list_channels 의 q 옵션으로 접혔다.
  it('채널 탐색은 list_channels(q) 로 안내하고 옛 discover_channels 는 없다 (WP-355)', () => {
    const prompt = loaded['messaging-agent'].prompt;
    expect(prompt).toContain('`list_channels(q)`');
    expect(prompt).not.toContain('discover_channels');
  });

  // WP-358: 메시지 첨부는 read_file(source="message") — id 의 출처를 읽기 도구 출력으로 안내하고 비-READY 상태 추측을 금한다.
  it('read_file 을 source "message" + channelId·messageId·attachmentId 로 안내하고 비-READY 상태 추측을 금한다 (WP-358)', () => {
    const prompt = loaded['messaging-agent'].prompt;
    expect(prompt).toContain('read_file(source="message", channelId, messageId, attachmentId, offset?, limit?)');
    expect(prompt).toContain('`attachments[].fileId`');
    expect(prompt).toMatch(/READY.*내용을 추측하지 말고/s);
  });
});
