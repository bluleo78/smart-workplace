import { useId } from 'react';

/**
 * 실시간 검증 안내(FieldError)와 그 안내를 가리키는 입력칸을 잇는 값 — 안내 리전 id 와 칸에 줄 ARIA 속성(WP-1934).
 * 안내가 떠 있는 동안만 칸이 오류(aria-invalid)이고 안내를 가리킨다(aria-describedby) — 빈 리전은 가리키지 않는다.
 * id 는 useId 로 만들어 같은 화면에 같은 폼이 둘 떠도 겹치지 않는다.
 *
 * 사용: `const hint = useFieldHint(message != null)` → `<Input {...hint.inputProps} />` · `<FieldError id={hint.id}>{message}</FieldError>`
 */
export function useFieldHint(active: boolean) {
  const id = useId();
  return {
    id,
    inputProps: {
      'aria-invalid': active || undefined,
      'aria-describedby': active ? id : undefined,
    },
  };
}
