// 프로젝트 설정 추가 폼(이슈 유형·라벨·프로젝트 필드)의 「빈 이름」 검사(WP-1561).
// 예전엔 이름이 비거나 공백뿐인 채 「추가」를 누르면 onCreate 가 조용히 끝나 사용자가 왜 안 되는지 몰랐다.
// 디자인 시스템 09-form-patterns 대로 제출 단추는 그대로 두고, 제출 시 검사해 칸 아래에 오류를 보이고 칸에 포커스를 둔다.

import { useRef, useState } from 'react';

/** 빈 이름 안내 문구 — 필드 편집 대화상자(CustomFieldEditDialog)와 같은 문구. */
export const EMPTY_NAME_MESSAGE = '이름을 입력해 주세요';

/**
 * 추가 폼 이름 칸의 빈 이름 오류 상태와 칸 ref 를 준다.
 * - check(name): 제출 직전에 부른다. 비었거나 공백뿐이면 오류를 켜고 칸에 포커스한 뒤 false(요청을 보내지 말 것).
 * - clear(): 이름이 바뀔 때 부른다 — 다시 입력하기 시작하면 오류를 지운다.
 */
export function useRequiredName() {
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function check(name: string): boolean {
    if (name.trim()) return true;
    setError(EMPTY_NAME_MESSAGE);
    inputRef.current?.focus();
    return false;
  }

  function clear() {
    setError(null);
  }

  return { error, inputRef, check, clear };
}
