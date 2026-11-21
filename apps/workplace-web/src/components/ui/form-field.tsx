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

interface FormErrorProps {
  id?: string;
  className?: string;
  'data-testid'?: string;
  children?: ReactNode;
}

/**
 * 폼 오류 안내 문단 — 필드 오류와 제출 실패(루트 오류)가 같은 모양·같은 role=alert 로 읽히게 하는 공용 컴포넌트(WP-1901).
 * 곳곳에 흩어진 `<p className="text-sm text-destructive">` 를 대체한다.
 * role=alert 는 **제출 실패** 안내에만 쓴다 — 입력 중 바뀌는 실시간 검증 안내는 아래 FieldError 를 쓴다.
 * children 이 null/undefined/false/'' 이면 아무것도 그리지 않아 호출부가 조건 분기를 하지 않아도 된다.
 */
export function FormError({ id, className, 'data-testid': testId, children }: FormErrorProps) {
  // 빈 내용이면 빈 alert 영역을 남기지 않는다
  if (children === null || children === undefined || children === false || children === '') return null;
  return (
    <p id={id} role="alert" data-testid={testId} className={cn('text-sm text-destructive', className)}>
      {children}
    </p>
  );
}

/**
 * 실시간(입력 중) 검증 실패 안내 — `role=status`(implicit `aria-live=polite`)로 그려 스크린리더가
 * 사용자의 입력을 끊지 않고 한 박자 뒤에 읽게 한다(WP-1901 리뷰 반려).
 * `role=alert`(assertive) 로 길이 초과·날짜 뒤집힘 같은 입력 중 안내를 쓰면 사용자가 타이핑하는 도중에
 * 알림이 끼어든다 — alert 는 제출 실패 안내(FormError)에만 남긴다.
 * 모양·빈 내용 처리는 FormError 와 같고, 칸과 잇는 id 를 주면 호출부의 aria-describedby 가 가리키게 한다.
 */
export function FieldError({ id, className, 'data-testid': testId, children }: FormErrorProps) {
  if (children === null || children === undefined || children === false || children === '') return null;
  return (
    <p id={id} role="status" aria-live="polite" data-testid={testId} className={cn('text-sm text-destructive', className)}>
      {children}
    </p>
  );
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
