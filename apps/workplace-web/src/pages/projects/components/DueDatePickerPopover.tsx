// 이슈 마감일 DatePicker — DatePickerPopover 위임 래퍼 (Task 11 제네릭 추출).
// 기존 due-date-picker/-trigger/-popover/-clear testid 와 "마감일 선택"/"마감일 지우기"
// aria-label 을 그대로 유지 — 기존 E2E(issue-due-date-picker.spec.ts) 가 이 testid 에 의존.
// 트리거 이름은 「마감일 선택: 보이는 날짜」로 값이 붙는다(WP-853, DatePickerPopover).

import { DatePickerPopover } from './DatePickerPopover';

interface DueDatePickerPopoverProps {
  /** YYYY-MM-DD 형식 또는 null (미설정) */
  value: string | null;
  /** 날짜 선택 시 YYYY-MM-DD 문자열을 반환. 지우기 시 undefined를 반환. */
  onChange: (date: string | undefined) => void;
  disabled?: boolean;
  /** 인라인 경고 문구 — 선행 이슈 마감일보다 이른 날짜 선택 등(#669, soft 경고). */
  warningText?: string | null;
  /** 마감 지난 미완료 이슈면 true — 날짜를 빨간 글씨 + 「· 마감 지남」으로(WP-649). */
  overdue?: boolean;
}

/**
 * 이슈 상세 패널의 마감일 DatePicker 컴포넌트.
 */
export function DueDatePickerPopover({
  value,
  onChange,
  disabled,
  warningText,
  overdue,
}: DueDatePickerPopoverProps) {
  return (
    <DatePickerPopover
      value={value}
      onChange={onChange}
      disabled={disabled}
      ariaLabel="마감일 선택"
      clearAriaLabel="마감일 지우기"
      testIdPrefix="due-date"
      warningText={warningText}
      overdueText={overdue ? '마감 지남' : null}
    />
  );
}
