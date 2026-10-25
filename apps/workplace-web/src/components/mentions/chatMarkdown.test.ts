import { describe, expect, it } from 'vitest';

import { stripChatMarkdown } from './chatMarkdown';
import { messagePlainText } from './parseMessageSegments';

// 서식 기호를 뺀 평문(WP-101) — 접근 이름·복사·답장 미리보기.
describe('stripChatMarkdown', () => {
  it.each([
    ['**굵게** *기울임* <u>밑줄</u> ~~취소~~ `코드`', '굵게 기울임 밑줄 취소 코드'],
    ['- 하나\n- 둘', '하나\n둘'],
    ['1. 첫째\n2. 둘째', '첫째\n둘째'],
    ['위\n\n- a\n\n아래', '위\na\n아래'],
    ['```\nx = 1\n```', 'x = 1'],
    ['[문서](https://a.com) 참고', '문서 참고'],
    ['**<@7>** 확인', '<@7> 확인'],
    // 평문은 그대로 — 이스케이프를 풀거나 밑줄 문자를 지우지 않는다.
    ['a_b 2*3 #해시 > 인용 \\*', 'a_b 2*3 #해시 > 인용 \\*'],
    ['첫 줄\n\n셋째 줄', '첫 줄\n\n셋째 줄'],
    ['2024. 10. 25. 회의', '2024. 10. 25. 회의'],
    ['', ''],
  ])('%j', (body, plain) => {
    expect(stripChatMarkdown(body)).toBe(plain);
  });

  it('messagePlainText 는 서식을 빼고 멘션을 이름으로', () => {
    expect(messagePlainText('**<@7>** 님 `확인`', [{ id: 7, name: '김철수', kind: 'HUMAN' }])).toBe('@김철수 님 확인');
  });
});
