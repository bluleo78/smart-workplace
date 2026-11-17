import { describe, expect, it } from 'vitest';

import type { IssueResponse, ParentRef } from '../types/issue';
import { issueEpicOf } from './epicGroup';

// issueEpicOf 는 parent 만 읽으므로 parent 만 가진 최소 객체로 검증한다(WP-1692).
const EPIC_TYPE = { id: 6, name: 'EPIC', colorToken: 'INDIGO', icon: 'Flag' } as const;
const STORY_TYPE = { id: 2, name: 'STORY', colorToken: 'BLUE', icon: 'Flag' } as const;
const epicRef: ParentRef = { number: 1, title: '결제 개편 에픽', type: EPIC_TYPE };
const withParent = (parent: ParentRef | null) => ({ parent }) as Pick<IssueResponse, 'parent'>;

describe('issueEpicOf (WP-1692)', () => {
  it('부모가 없으면 null', () => {
    expect(issueEpicOf(withParent(null))).toBeNull();
  });

  it('직계 부모가 에픽이면 그 부모', () => {
    expect(issueEpicOf(withParent(epicRef))).toBe(epicRef);
  });

  it('부모가 스토리면 parent.epic(할아버지 에픽)', () => {
    const story: ParentRef = { number: 2, title: '스토리', type: STORY_TYPE, epic: epicRef };
    expect(issueEpicOf(withParent(story))).toBe(epicRef);
  });

  it('부모가 스토리이고 epic 이 없으면 null', () => {
    const story: ParentRef = { number: 2, title: '스토리', type: STORY_TYPE };
    expect(issueEpicOf(withParent(story))).toBeNull();
  });

  it('가려진 직계 부모는 그 부모(가려진 에픽)', () => {
    const hidden = { number: 0, title: '', type: null, hidden: true } as unknown as ParentRef;
    expect(issueEpicOf(withParent(hidden))).toBe(hidden);
  });
});
