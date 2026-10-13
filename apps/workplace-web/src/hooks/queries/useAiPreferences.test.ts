// WP-139 설정 쿼리 키 — 로그아웃 뒤 같은 탭에서 다른 계정으로 들어와도 이전 사용자의 켜기/끄기 캐시를 쓰지 않도록 사용자별로 나뉘는지 본다.
import { describe, expect, it } from 'vitest';

import { aiPreferenceKeys, mergeSentPreferences } from './useAiPreferences';

describe('aiPreferenceKeys.me', () => {
  it('사용자마다 다른 키 — 다른 계정의 캐시를 재사용하지 않는다', () => {
    expect(aiPreferenceKeys.me(1)).not.toEqual(aiPreferenceKeys.me(2));
    expect(aiPreferenceKeys.me(1)).toEqual(aiPreferenceKeys.me(1));
  });
  it('모든 사용자 키가 같은 접두로 시작한다 — 접두 무효화 한 번으로 모두 지울 수 있다', () => {
    expect(aiPreferenceKeys.me(3).slice(0, aiPreferenceKeys.all.length)).toEqual([...aiPreferenceKeys.all]);
  });
});

// F-i: 두 스위치의 저장이 겹쳐도 서로의 값을 덮지 않는다 — 보낸 필드만 응답 값으로 바꾼다.
describe('mergeSentPreferences', () => {
  it('보낸 필드만 응답 값으로 바꾸고 다른 필드는 캐시 값을 지킨다', () => {
    const cache = { suggestionsEnabled: false, memoryEnabled: false };
    // 추천 저장의 늦은 응답(메모리는 저장 전 값 true) — 메모리를 되돌리지 않는다.
    expect(mergeSentPreferences(cache, { suggestionsEnabled: false }, { suggestionsEnabled: false, memoryEnabled: true })).toEqual(cache);
    expect(mergeSentPreferences(cache, { memoryEnabled: true }, { suggestionsEnabled: true, memoryEnabled: true })).toEqual({
      suggestionsEnabled: false,
      memoryEnabled: true,
    });
  });
  it('캐시가 없으면 응답 전체를 쓴다', () => {
    const data = { suggestionsEnabled: true, memoryEnabled: false };
    expect(mergeSentPreferences(undefined, { memoryEnabled: false }, data)).toEqual(data);
  });
});
