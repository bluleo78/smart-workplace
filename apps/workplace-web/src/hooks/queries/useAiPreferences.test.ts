// WP-139 설정 쿼리 키 — 로그아웃 뒤 같은 탭에서 다른 계정으로 들어와도 이전 사용자의 켜기/끄기 캐시를 쓰지 않도록 사용자별로 나뉘는지 본다(최종 리뷰 M7).
import { describe, expect, it } from 'vitest';

import { aiPreferenceKeys } from './useAiPreferences';

describe('aiPreferenceKeys.me', () => {
  it('사용자마다 다른 키 — 다른 계정의 캐시를 재사용하지 않는다', () => {
    expect(aiPreferenceKeys.me(1)).not.toEqual(aiPreferenceKeys.me(2));
    expect(aiPreferenceKeys.me(1)).toEqual(aiPreferenceKeys.me(1));
  });
  it('모든 사용자 키가 같은 접두로 시작한다 — 접두 무효화 한 번으로 모두 지울 수 있다', () => {
    expect(aiPreferenceKeys.me(3).slice(0, aiPreferenceKeys.all.length)).toEqual([...aiPreferenceKeys.all]);
  });
});
