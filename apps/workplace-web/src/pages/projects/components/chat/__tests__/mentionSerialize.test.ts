import { describe, expect, it } from 'vitest';

import type { ChatMentionResponse } from '../../../../../types/chat';
import { bodyToDoc, serializeToBody } from '../../../../../components/mentions/mentionSerialize';

const AI: ChatMentionResponse = { id: 99, username: 'ai-agent', name: 'AI Agent', kind: 'AGENT' };

describe('serializeToBody', () => {
  it('텍스트 + mention 노드를 <@id> 본문으로 직렬화', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'hi ' },
            { type: 'mention', attrs: { id: 99, label: 'AI Agent' } },
            { type: 'text', text: ' 확인' },
          ],
        },
      ],
    };
    expect(serializeToBody(doc)).toBe('hi <@99> 확인');
  });

  it('여러 문단은 줄바꿈으로 합친다', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
      ],
    };
    expect(serializeToBody(doc)).toBe('a\nb');
  });

  it('빈 문서는 빈 문자열', () => {
    expect(serializeToBody({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe('');
  });
});

describe('bodyToDoc', () => {
  it('<@id> 를 mention 노드(label=이름)로 복원', () => {
    const doc = bodyToDoc('hi <@99> 확인', [AI]);
    expect(doc).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'hi ' },
            { type: 'mention', attrs: { id: 99, label: 'AI Agent' } },
            { type: 'text', text: ' 확인' },
          ],
        },
      ],
    });
  });

  it('mentions 에 없는 id 는 label "알 수 없음"', () => {
    const doc = bodyToDoc('<@5>', []);
    expect(doc.content?.[0].content?.[0]).toEqual({
      type: 'mention',
      attrs: { id: 5, label: '알 수 없음' },
    });
  });

  it('직렬화 라운드트립', () => {
    const body = 'a <@99> b';
    expect(serializeToBody(bodyToDoc(body, [AI]))).toBe(body);
  });
});
