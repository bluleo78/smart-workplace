import { describe, expect, it } from 'vitest';

import {
  HIDDEN_PARENT_LABEL,
  isHiddenParent,
  isSameParent,
  parentIssueKey,
  parentIssuePath,
  parentProjectKey,
  parentRequestBody,
} from './parentRef';

// WP-1038 부모(에픽)는 다른 프로젝트에 있을 수 있다 — 키·경로는 부모의 프로젝트 키로, 가려진 부모는 키·경로 없음.
describe('parentRef', () => {
  it('부모의 projectKey 를 먼저, 없으면 자식 프로젝트 키를 쓴다', () => {
    expect(parentProjectKey({ projectKey: 'PLAN' }, 'WP')).toBe('PLAN');
    expect(parentProjectKey({ projectKey: null }, 'WP')).toBe('WP');
    expect(parentProjectKey({}, 'WP')).toBe('WP');
    expect(parentIssueKey({ number: 3, projectKey: 'PLAN' }, 'WP')).toBe('PLAN-3');
    expect(parentIssuePath({ number: 3 }, 'WP')).toBe('/projects/WP/issues/3');
  });

  it('가려진 부모는 키·경로가 없다', () => {
    const hidden = { number: 0, hidden: true };
    expect(isHiddenParent(hidden)).toBe(true);
    expect(parentIssueKey(hidden, 'WP')).toBeNull();
    expect(parentIssuePath(hidden, 'WP')).toBeNull();
    expect(HIDDEN_PARENT_LABEL).toBe('볼 수 없는 에픽');
  });

  // WP-1039 부모 지정 요청 — 같은 프로젝트는 번호, 다른 프로젝트 에픽은 키.
  it('부모 지정 본문은 같은 프로젝트면 parentNumber, 다른 프로젝트면 parentKey', () => {
    expect(parentRequestBody(null, 'WP')).toEqual({ parentNumber: null });
    expect(parentRequestBody({ number: 3 }, 'WP')).toEqual({ parentNumber: 3 });
    expect(parentRequestBody({ projectKey: 'WP', number: 3 }, 'WP')).toEqual({ parentNumber: 3 });
    expect(parentRequestBody({ projectKey: 'PLAN', number: 3 }, 'WP')).toEqual({ parentKey: 'PLAN-3' });
  });

  // WP-1039 「지금 에픽」 비교 — 번호만 같은 다른 프로젝트 에픽을 같은 에픽으로 보지 않는다.
  it('isSameParent 는 프로젝트까지 비교한다', () => {
    expect(isSameParent(null, null, 'WP')).toBe(true);
    expect(isSameParent(null, { number: 5 }, 'WP')).toBe(false);
    expect(isSameParent({ number: 5 }, null, 'WP')).toBe(false);
    expect(isSameParent({ number: 5 }, { number: 5 }, 'WP')).toBe(true);
    expect(isSameParent({ number: 5, projectKey: 'WP' }, { number: 5 }, 'WP')).toBe(true);
    expect(isSameParent({ number: 5, projectKey: 'CLA' }, { number: 5 }, 'WP')).toBe(false);
    expect(isSameParent({ number: 5, projectKey: 'CLA' }, { number: 5, projectKey: 'CLA' }, 'WP')).toBe(true);
    // 가려진 부모는 어느 대상과도, 「에픽 없음」과도 같지 않다.
    expect(isSameParent({ number: 0, hidden: true }, null, 'WP')).toBe(false);
    expect(isSameParent({ number: 0, hidden: true }, { number: 0 }, 'WP')).toBe(false);
  });
});
