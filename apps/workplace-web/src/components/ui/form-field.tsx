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
      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
