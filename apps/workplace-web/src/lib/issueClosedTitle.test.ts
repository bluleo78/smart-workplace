import { describe, expect, it } from 'vitest';

import { issueClosedTitleClass } from './issueClosedTitle';

describe('issueClosedTitleClass', () => {
  it.each(['TODO', 'IN_PROGRESS', 'UNKNOWN'])('%s 상태는 기본 제목 스타일을 유지한다', (status) => {
    expect(issueClosedTitleClass(status)).toBe('');
  });

  it('DONE 범주는 완료 제목을 흐리게 표시한다', () => {
    expect(issueClosedTitleClass('DONE')).toBe('text-muted-foreground group-hover:text-foreground');
  });

  it('CANCELED 범주는 제목을 흐리게 표시하고 삭선을 긋는다', () => {
    expect(issueClosedTitleClass('CANCELED')).toBe('text-muted-foreground group-hover:text-foreground line-through');
  });

  it('호버 색을 바꾸거나(홈 위젯 강조색) 빈 값으로 끌 수 있다', () => {
    expect(issueClosedTitleClass('DONE', 'group-hover:text-ai-accent')).toBe('text-muted-foreground group-hover:text-ai-accent');
    expect(issueClosedTitleClass('CANCELED', '')).toBe('text-muted-foreground line-through');
    expect(issueClosedTitleClass('TODO', 'group-hover:text-ai-accent')).toBe('');
  });
});
