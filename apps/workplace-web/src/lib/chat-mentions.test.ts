import { describe, expect, it } from 'vitest';

import type { ChatMemberResponse } from '../types/chat';
import { hydrateMentions } from './chat-mentions';

const members: ChatMemberResponse[] = [
  { userId: 1, username: 'me', name: '나', kind: 'HUMAN', lastReadMessageId: null, joinedAt: '' },
  {
    userId: 99,
    username: 'ai',
    name: 'AI Agent',
    kind: 'AGENT',
    lastReadMessageId: null,
    joinedAt: '',
  },
];

describe('hydrateMentions', () => {
  it('본문의 <@id> 토큰을 멤버 정보로 채운다', () => {
    expect(hydrateMentions('hi <@99>', members)).toEqual([
      { id: 99, username: 'ai', name: 'AI Agent', kind: 'AGENT' },
    ]);
  });

  it('멤버 목록에 없는 id 는 제외한다', () => {
    expect(hydrateMentions('<@404>', members)).toEqual([]);
  });

  it('중복 멘션은 한 번만, 등장 순서를 보존한다', () => {
    expect(hydrateMentions('<@99> <@1> <@99>', members)).toEqual([
      { id: 99, username: 'ai', name: 'AI Agent', kind: 'AGENT' },
      { id: 1, username: 'me', name: '나', kind: 'HUMAN' },
    ]);
  });

  it('멘션이 없으면 빈 배열', () => {
    expect(hydrateMentions('그냥 텍스트', members)).toEqual([]);
  });
});
