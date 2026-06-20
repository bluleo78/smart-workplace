import { describe, expect, it } from 'vitest';

import {
  bodyToDoc,
  convertPlaintextMentions,
  serializeToBody,
} from '../../../../../components/mentions/mentionSerialize';
import type { ChatMentionResponse } from '../../../../../types/chat';

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

// #366: 평문 @에이전트 멘션을 <@id> 로 변환.
describe('convertPlaintextMentions', () => {
  const MY_AI = { userId: 3, name: 'My AI', kind: 'AGENT' as const };
  const MY_AI_PRO = { userId: 7, name: 'My AI Pro', kind: 'AGENT' as const };
  const HUMAN = { userId: 5, name: '홍길동', kind: 'HUMAN' as const };

  it('공백이 포함된 이름도 전체 문자열로 매칭해 변환', () => {
    expect(convertPlaintextMentions('@My AI 안녕, 자기소개 해줘', [MY_AI])).toBe(
      '<@3> 안녕, 자기소개 해줘',
    );
  });

  it('문자열 시작 위치의 @이름 변환', () => {
    expect(convertPlaintextMentions('@My AI', [MY_AI])).toBe('<@3>');
  });

  it('긴 이름 우선(longest-first) — "My AI Pro" 를 "My AI" 보다 먼저 매칭', () => {
    expect(convertPlaintextMentions('@My AI Pro 님', [MY_AI, MY_AI_PRO])).toBe('<@7> 님');
  });

  it('이미 <@id> 토큰(드롭다운 경로)은 그대로 둔다', () => {
    expect(convertPlaintextMentions('<@3> 안녕', [MY_AI])).toBe('<@3> 안녕');
  });

  it('이메일 주소(user@...)는 변환하지 않는다 — 앞 경계', () => {
    expect(convertPlaintextMentions('user@My AI', [MY_AI])).toBe('user@My AI');
  });

  it('더 긴 토큰의 부분일치는 변환하지 않는다 — 뒤 경계', () => {
    expect(convertPlaintextMentions('@My AIx', [MY_AI])).toBe('@My AIx');
  });

  it('HUMAN 멤버는 변환 대상이 아니다(AI 트리거 목적)', () => {
    expect(convertPlaintextMentions('@홍길동 안녕', [HUMAN])).toBe('@홍길동 안녕');
  });

  it('괄호 등 비단어 문자 뒤의 @이름도 변환', () => {
    expect(convertPlaintextMentions('(@My AI)', [MY_AI])).toBe('(<@3>)');
  });

  it('매칭 없으면 원문 유지', () => {
    expect(convertPlaintextMentions('일반 메시지입니다', [MY_AI])).toBe('일반 메시지입니다');
  });
});
