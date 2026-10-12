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
      'mcp__workplace__list_channels',
      'mcp__workplace__discover_channels',
      // #855: 채널 생성·DM 열기·공개 채널 나가기
      'mcp__workplace__create_channel',
      'mcp__workplace__open_dm',
      'mcp__workplace__leave_channel',
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
    expect(prompt).toContain('list_channels(limit?, offset?)');
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
});
