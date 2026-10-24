import { describe, expect, it } from 'vitest';

import { itemActionLabel, quotedSnippet } from './itemActionLabel';

// WP-940 — 행마다 반복되는 버튼 이름에 대상(본문 미리보기)을 붙여 서로 구분되게 한다.
describe('itemActionLabel (WP-940)', () => {
  it('본문 미리보기 + 종류 + 동작', () => {
    expect(itemActionLabel('회의는 3시', '메시지', '수정')).toBe('「회의는 3시」 메시지 수정');
  });
  it('긴 본문은 20자에서 자르고, 공백·줄바꿈은 한 칸으로', () => {
    expect(quotedSnippet('가나다라마바사아자차카타파하 가나다라마바사아자차')).toBe('「가나다라마바사아자차카타파하 가나다라마…」');
    expect(quotedSnippet('첫 줄\n\n  둘째 줄')).toBe('「첫 줄 둘째 줄」');
  });
  it('본문이 비면 종류 + 동작만', () => {
    expect(itemActionLabel('', '메시지', '삭제')).toBe('메시지 삭제');
    expect(itemActionLabel('   ', '메모리', '수정')).toBe('메모리 수정');
    expect(itemActionLabel(null, '메모리', '수정')).toBe('메모리 수정');
  });
  it('서로 다른 행은 이름이 다르다', () => {
    expect(itemActionLabel('첫 메시지', '메시지', '삭제')).not.toBe(itemActionLabel('둘째 메시지', '메시지', '삭제'));
  });
});
