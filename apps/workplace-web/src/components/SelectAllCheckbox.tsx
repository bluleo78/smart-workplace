import { type InputHTMLAttributes, useLayoutEffect, useRef } from 'react';

/**
 * 목록 머리의 전체선택 체크박스(공용, WP-1071) — 일부만 고르면 「일부 선택」(가로줄, 읽기 도구에는 「혼합」)으로 보인다.
 * indeterminate 는 HTML 속성이 아니라 DOM 속성이라 ref 로 준다. 누르면 브라우저가 스스로 지우므로 매 렌더 그리기 전에 다시 맞춘다.
 */
export function SelectAllCheckbox({
  indeterminate,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { indeterminate: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  });
  // ref 는 펼친 props 뒤에 — 호출 쪽이 ref 를 넘겨도 안의 ref 가 덮이지 않게.
  return <input {...props} ref={ref} type="checkbox" />;
}
