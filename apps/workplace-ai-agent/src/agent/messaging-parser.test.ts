// parseRelevantJson 직접 단위 테스트 — 중첩 JSON 파싱 검증.
// 기존 messaging.test.ts 는 runMessagingClassify 를 스텁해 파서를 우회하므로
// 이 파일에서 파서를 직접 테스트한다.
import { describe, it, expect } from 'vitest';
import { parseRelevantJson } from './run-messaging-ai.js';

describe('parseRelevantJson', () => {
  it('중첩 JSON — userId/reason 정상 파싱', () => {
    const text = '{"relevant":[{"userId":1,"reason":"이름 직접 언급"}]}';
    const result = parseRelevantJson(text);
    expect(result.relevant).toHaveLength(1);
    expect(result.relevant[0].userId).toBe(1);
    expect(result.relevant[0].reason).toBe('이름 직접 언급');
  });

  it('다수 멤버 — 모두 파싱', () => {
    const text = '{"relevant":[{"userId":2,"reason":"담당자 추정"},{"userId":5,"reason":"질문 대기"}]}';
    const result = parseRelevantJson(text);
    expect(result.relevant).toHaveLength(2);
    expect(result.relevant[1].userId).toBe(5);
  });

  it('빈 relevant 배열 — 정상 반환', () => {
    const text = '{"relevant":[]}';
    const result = parseRelevantJson(text);
    expect(result.relevant).toHaveLength(0);
  });

  it('코드펜스 + 잡설 포함 — 정상 파싱', () => {
    const text =
      '물론이죠. 분석 결과입니다.\n```json\n{"relevant":[{"userId":3,"reason":"배포 담당자"}]}\n```\n이상입니다.';
    const result = parseRelevantJson(text);
    expect(result.relevant).toHaveLength(1);
    expect(result.relevant[0].userId).toBe(3);
  });

  it('코드펜스 없이 앞뒤 잡설 포함 — 정상 파싱', () => {
    const text = '분석 결과: {"relevant":[{"userId":7,"reason":"직접 언급"}]} 이상.';
    const result = parseRelevantJson(text);
    expect(result.relevant).toHaveLength(1);
    expect(result.relevant[0].userId).toBe(7);
  });

  it('JSON 없음 — 빈 결과 폴백', () => {
    const result = parseRelevantJson('관련 멤버 없습니다.');
    expect(result.relevant).toHaveLength(0);
  });

  it('스키마 불일치(userId 누락) — 빈 결과 폴백', () => {
    const result = parseRelevantJson('{"relevant":[{"reason":"이유만"}]}');
    expect(result.relevant).toHaveLength(0);
  });

  it('파싱 불가 JSON — 빈 결과 폴백', () => {
    const result = parseRelevantJson('{broken json here}');
    expect(result.relevant).toHaveLength(0);
  });
});
