import { describe, expect, it } from 'vitest';
import { mockPatApiClient } from './test-support.js';
import { buildUserTools } from './index.js';

describe('buildUserTools', () => {
  it('이슈 10 + 위키 5 + 메시징 3 + 캘린더 2 + 드라이브 3 + 메일 3 = 총 26개 도구를 이름 중복 없이 반환한다', () => {
    const tools = buildUserTools(mockPatApiClient());
    const names = tools.map((t) => t.name);
    expect(names).toHaveLength(26);
    expect(new Set(names).size).toBe(names.length);
  });
});
