import { describe, expect, it } from 'vitest';
import { buildDecisionHeadingRe, hasDecisionSection } from './decision-section.js';

// WP-1376: 「정해 주세요」 절 판별 — 제목 모양은 관대하게, 결과 맨 끝 절이어야 하고, 비었거나 「없음」뿐이면 질문이 아니다.
describe('hasDecisionSection', () => {
  it('#~#### 제목, 앞 공백, 굵게 감싼 제목, 띄어쓰기 빠짐, 끝 콜론을 받는다', () => {
    for (const h of [
      '# 정해 주세요', '## 정해 주세요', '### 정해 주세요', '#### 정해 주세요', '  ## 정해 주세요  ', '## **정해 주세요**',
      '##정해주세요', '## 정해 주세요:',
    ]) {
      expect(hasDecisionSection(`결과\n\n${h}\n1. 회신할까요?`), h).toBe(true);
    }
  });

  it('굵게만 쓴 줄(**정해 주세요**, 콜론 포함)도 절 제목으로 본다', () => {
    for (const h of ['**정해 주세요**', '**정해 주세요:**', '**정해 주세요**:', '__정해주세요__']) {
      expect(hasDecisionSection(`## 정리\n- 메일 3건\n\n${h}\n1. 회신할까요?`), h).toBe(true);
    }
  });

  it('##### 이상 제목이나 본문 속 「정해 주세요」는 절로 보지 않는다', () => {
    expect(hasDecisionSection('##### 정해 주세요\n1. 회신할까요?')).toBe(false);
    expect(hasDecisionSection('아래를 정해 주세요\n1. 회신할까요?')).toBe(false);
    expect(hasDecisionSection('**정해 주세요** 회신 여부\n1. 회신할까요?')).toBe(false);
  });

  it('글머리표 항목도 항목으로 본다', () => {
    expect(hasDecisionSection('## 정해 주세요\n- 회신할까요?')).toBe(true);
  });

  it('절이 없거나, 비었거나, 「없음」뿐이거나, 항목이 다음 절에만 있으면 질문이 아니다', () => {
    expect(hasDecisionSection('## 정리\n1. 회신 완료')).toBe(false);
    expect(hasDecisionSection('## 정리\n- 없음\n\n## 정해 주세요\n')).toBe(false);
    expect(hasDecisionSection('## 정해 주세요\n\n   \n')).toBe(false);
    expect(hasDecisionSection('## 정해 주세요\n1. 없음')).toBe(false);
    expect(hasDecisionSection('## 정해 주세요\n- (해당 없음)')).toBe(false);
    expect(hasDecisionSection('## 정해 주세요\n## 제안\n1. 폴더를 나누면 좋겠습니다')).toBe(false);
  });

  it('굵게만 쓴 이름표 줄(**제안**)도 절을 끝낸다 — 그 뒤 항목은 정할 항목이 아니고, 정해 주세요가 마지막 절도 아니다', () => {
    expect(hasDecisionSection('## 정해 주세요\n**제안**\n1. 폴더를 나누면 좋겠습니다')).toBe(false);
    expect(hasDecisionSection('## 정해 주세요\n1. 회신할까요?\n\n**제안**:\n- 폴더를 나누면 좋겠습니다')).toBe(false);
  });

  it('결과 맨 끝 절이어야 한다 — 중간의 「정해 주세요」(인용한 메일 글 등) 뒤에 다른 절이 이어지면 질문이 아니다', () => {
    const quoted = '## 받은 메일\n> 아래 중 하나를 골라 주세요\n\n### 정해 주세요\n1. 회의 시간 A / B\n\n## 오늘 정리\n- 메일 1건 분류';
    expect(hasDecisionSection(quoted)).toBe(false);
    // 뒤에 오는 제목이 비어 있으면(내용 없음) 정해 주세요가 여전히 마지막 절이다. 가로줄도 내용이 아니다.
    expect(hasDecisionSection('## 정해 주세요\n1. 회신할까요?\n\n---\n\n## \n')).toBe(true);
    // 정해 주세요 절이 두 번이면 마지막 것만 본다.
    expect(hasDecisionSection('## 정해 주세요\n1. 회신?\n\n## 정리\n- 끝\n\n## 정해 주세요\n')).toBe(false);
  });

  it('코드 울타리 안 줄은 제목·경계·항목으로 보지 않는다', () => {
    // 울타리 안 「정해 주세요」 제목은 절이 아니다(울타리는 내용이라 마지막 절은 「정리」).
    expect(hasDecisionSection('## 정리\n```\n## 정해 주세요\n1. 회신?\n```')).toBe(false);
    expect(hasDecisionSection('## 정리\n~~~md\n## 정해 주세요\n1. 회신?\n~~~')).toBe(false);
    // 울타리 안 항목은 세지 않는다.
    expect(hasDecisionSection('## 정해 주세요\n```\n1. 회신?\n```')).toBe(false);
    // 울타리 안 제목은 절을 끝내지 않는다 — 그 뒤 울타리 밖 항목은 여전히 정해 주세요 절의 항목이다.
    expect(hasDecisionSection('## 정해 주세요\n```\n## 예시\n```\n1. 위 예시대로 보낼까요?')).toBe(true);
  });
});

// 제목 상수에 정규식 특수 문자가 있어도 글자 그대로 맞는다(낱말마다 감싸고 사이 공백은 선택).
describe('buildDecisionHeadingRe', () => {
  it('특수 문자를 글자 그대로 맞추고 낱말 사이 공백은 있어도 없어도 된다', () => {
    const re = buildDecisionHeadingRe('골라 (주세요)?');
    expect(re.test('## 골라 (주세요)?')).toBe(true);
    expect(re.test('## 골라(주세요)?')).toBe(true);
    expect(re.test('## 골라 주세요')).toBe(false);
    expect(re.test('## 골라 (주세요)')).toBe(false);
  });
});
