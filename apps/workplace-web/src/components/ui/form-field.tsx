import { Children, cloneElement, isValidElement } from 'react';
import type { ReactNode } from 'react';
import { Label } from './label';
import { cn } from '@/lib/utils';

interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  required?: boolean;
  /** 필드 밖에 따로 그린 오류 안내의 id(예: 서버 거절 사유, WP-1776). 있으면 칸을 오류로 보고 aria-describedby 에 함께 잇는다. */
  externalErrorId?: string;
  children: ReactNode;
  className?: string;
}

interface HintProps {
  id?: string;
  className?: string;
  'data-testid'?: string;
  children?: ReactNode;
}

/** 안내 문단이 비어 있는지 — null·undefined/false/'' 는 안내가 없는 것이다. */
const isEmptyHint = (children: ReactNode) =>
  children === null || children === undefined || children === false || children === '';

/**
 * 폼 안내 문단의 공통 그림 — FormError(alert)·FieldError(status) 는 role 과 빈 내용 처리만 다르다(WP-1934).
 * 두 컴포넌트가 같은 자식 구조·클래스를 따로 만들면 고치는 곳이 하나씩 빠진다.
 */
function Hint({
  id,
  className,
  'data-testid': testId,
  role,
  children,
}: HintProps & { role: 'alert' | 'status' }) {
  const empty = isEmptyHint(children);
  // 제출 실패 안내(alert)는 빈 문단을 남기지 않는다 — 없는 안내가 미리 그려져 있는 것처럼 보이기 때문이다.
  if (role === 'alert' && empty) return null;
  // 실시간 검증 안내(status)는 리전을 늘 두되 빈 동안은 화면 흐름에서 빠진다(sr-only) —
  // 리전이 내용과 같은 렌더에 생기면 polite 안내를 읽지 않고, 조건부로 지웠다 다시 그리면 간격이 흔들린다(WP-1934).
  return (
    <p
      id={id}
      role={role}
      aria-live={role === 'status' ? 'polite' : undefined}
      data-testid={testId}
      className={cn(empty ? 'sr-only' : 'text-sm text-destructive', className)}
    >
      {children}
    </p>
  );
}

/**
 * 폼 오류 안내 문단 — 필드 오류와 제출 실패(루트 오류)가 같은 모양·같은 role=alert 로 읽히게 하는 공용 컴포넌트(WP-1901).
 * 곳곳에 흩어진 `<p className="text-sm text-destructive">` 를 대체한다.
 * role=alert 는 **제출 실패** 안내에만 쓴다 — 입력 중 바뀌는 실시간 검증 안내는 아래 FieldError 를 쓴다.
 */
export function FormError(props: HintProps) {
  return <Hint {...props} role="alert" />;
}

/**
 * 실시간(입력 중) 검증 실패 안내 — `role=status`(implicit `aria-live=polite`)로 그려 스크린리더가
 * 사용자의 입력을 끊지 않고 한 박자 뒤에 읽게 한다(WP-1901 리뷰 반려).
 * `role=alert`(assertive) 로 길이 초과·날짜 뒤집힘 같은 입력 중 안내를 쓰면 사용자가 타이핑하는 도중에
 * 알림이 끼어든다 — alert 는 제출 실패 안내(FormError)에만 남긴다.
 * 호출부는 조건 없이 늘 렌더한다 — 리전이 미리 DOM 에 있어야 글자가 바뀔 때 읽히기 때문이다(빈 동안은 sr-only).
 * 빈 리전은 absolute(sr-only)라 자리를 차지하지 않지만, `space-y-*` 부모의 마지막 자식이면 앞 형제에 여백이 붙는다 —
 * 그런 자리는 부모를 `flex flex-col gap-*` 로 둔다(WP-1934). 칸과 잇는 id·ARIA 는 `useFieldHint`(@/hooks/useFieldHint).
 * 칸과 잇는 id 를 주면 호출부의 aria-describedby 가 가리키게 한다.
 */
export function FieldError(props: HintProps) {
  return <Hint {...props} role="status" />;
}

/**
 * 폼 필드 래퍼 — 레이블·에러 메시지·ARIA 연결을 중앙 관리한다.
 * 에러가 있으면 children(Input/Textarea)에 aria-invalid/aria-describedby를 자동 주입해
 * 스크린리더 사용자가 에러를 인지할 수 있도록 한다(WCAG 3.3.1/3.3.3).
 */
export function FormField({ label, htmlFor, error, required, externalErrorId, children, className }: FormFieldProps) {
  // htmlFor 기반으로 에러 메시지 ID 파생 — aria-describedby 연결용
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  // 필드 안 오류(error)와 필드 밖 오류 안내(externalErrorId)를 함께 잇는다 — 어느 쪽이든 있으면 칸은 오류 상태다.
  const describedByIds = [error && errorId, externalErrorId].filter(Boolean).join(' ');
  const invalid = !!(error || externalErrorId);

  // children에 aria-invalid/aria-describedby 자동 주입 (cloneElement)
  const childrenWithAria = Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    return cloneElement(child as React.ReactElement<Record<string, unknown>>, {
      'aria-invalid': invalid || undefined,
      ...(describedByIds ? { 'aria-describedby': describedByIds } : {}),
    });
  });

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {childrenWithAria}
      <FormError id={errorId}>{error}</FormError>
    </div>
  );
}
