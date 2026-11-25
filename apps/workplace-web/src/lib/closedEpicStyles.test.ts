// closedEpicTitleClass — 종료 에픽 제목의 흐림·삭선·호버 복원(WP-2101).
import { describe, expect, test } from 'vitest';

import { closedEpicTitleClass } from './closedEpicStyles';

describe('closedEpicTitleClass', () => {
  test('선택되지 않은 DONE 은 흐리게 두되 행 호버 때 또렷해지고 삭선은 없다', () => {
    const c = closedEpicTitleClass('DONE', false);
    expect(c).toContain('text-muted-foreground');
    expect(c).toContain('group-hover:text-foreground');
    expect(c).not.toContain('line-through');
  });

  test('선택되지 않은 CANCELED 는 삭선이 붙는다', () => {
    expect(closedEpicTitleClass('CANCELED', false)).toContain('line-through');
  });

  test('선택된 DONE 은 text-foreground 이고 흐림이 없다', () => {
    const c = closedEpicTitleClass('DONE', true);
    expect(c).toContain('text-foreground');
    expect(c).not.toContain('text-muted-foreground');
  });

  test('hoverRestore 를 끄면(모바일 시트·드래그 중) 호버 복원 클래스가 없다', () => {
    const c = closedEpicTitleClass('CANCELED', false, false);
    expect(c).toContain('text-muted-foreground');
    expect(c).toContain('line-through');
    expect(c).not.toContain('group-hover:text-foreground');
  });
});
