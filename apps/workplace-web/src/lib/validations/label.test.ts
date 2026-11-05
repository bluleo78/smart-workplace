// 라벨 이름 쉼표 금지(WP-1386) — 순수 판정 단위 테스트. 화면 반영은 labels.test.tsx·labelInlineCreate.test.tsx 가 본다.
import { describe, expect, it } from 'vitest';

import { LABEL_NAME_COMMA_MESSAGE, labelNameError, labelRenameError } from './label';

describe('labelNameError', () => {
  it('ASCII 쉼표가 있으면 서버와 같은 문구', () => {
    expect(labelNameError('a,b')).toBe('라벨 이름에는 쉼표(,)를 쓸 수 없습니다');
    expect(labelNameError(',')).toBe(LABEL_NAME_COMMA_MESSAGE);
    expect(labelNameError('끝,')).toBe(LABEL_NAME_COMMA_MESSAGE);
  });

  it('쉼표가 없거나 전각 쉼표(，)면 null', () => {
    expect(labelNameError('severity:minor')).toBeNull();
    expect(labelNameError('a，b')).toBeNull();
    expect(labelNameError('')).toBeNull();
  });
});

describe('labelRenameError', () => {
  it('지금 이름 그대로면(앞뒤 공백 무시) 쉼표가 있어도 null — 색만 바꾸는 저장', () => {
    expect(labelRenameError('a,b', 'a,b')).toBeNull();
    expect(labelRenameError(' a,b ', 'a,b')).toBeNull();
    // 서버와 같은 한 줄 다듬기 — 제로폭 공백·줄바꿈이 붙어도 같은 이름이다.
    expect(labelRenameError('\u200Ba,b\n', 'a,b')).toBeNull();
  });

  it('다른 이름으로 바꾸면 쉼표를 막고, 쉼표 없는 이름은 된다', () => {
    expect(labelRenameError('a,c', 'a,b')).toBe(LABEL_NAME_COMMA_MESSAGE);
    expect(labelRenameError('x,y', 'plain')).toBe(LABEL_NAME_COMMA_MESSAGE);
    expect(labelRenameError('a-b', 'a,b')).toBeNull();
  });
});
