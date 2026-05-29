import { describe, expect, it } from 'vitest';

import type { ChatMentionResponse } from '../../../../../types/chat';
import { parseMessageSegments } from '../parseMessageSegments';

const AI: ChatMentionResponse = { id: 99, username: 'ai-agent', name: 'AI Agent', kind: 'AGENT' };

describe('parseMessageSegments', () => {
  it('텍스트 + mention 토큰을 세그먼트로 분리', () => {
    expect(parseMessageSegments('hi <@99> 확인', [AI])).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'mention', id: 99, name: 'AI Agent', kind: 'AGENT' },
      { type: 'text', value: ' 확인' },
    ]);
  });

  it('mentions 에 없는 id 는 이름 "알 수 없음", kind HUMAN', () => {
    expect(parseMessageSegments('<@5>', [])).toEqual([
      { type: 'mention', id: 5, name: '알 수 없음', kind: 'HUMAN' },
    ]);
  });

  it('토큰 없으면 단일 텍스트 세그먼트', () => {
    expect(parseMessageSegments('그냥 텍스트', [])).toEqual([
      { type: 'text', value: '그냥 텍스트' },
    ]);
  });
});
