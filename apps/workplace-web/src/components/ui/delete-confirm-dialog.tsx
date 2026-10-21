import type { ReactNode } from 'react';

import { eulReul } from '../../lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog';

interface BaseProps {
  entityName: string;
  itemName: string;
  onConfirm: () => void;
  /** 기본 자동 생성 문구 대신 사용할 커스텀 설명. 미지정 시 자동 생성. */
  description?: ReactNode;
  /**
   * 설명 아래 덧붙이는 영향 안내(WP-488 — 「이슈 N개에서 라벨이 빠집니다」). 문자열이면 강조 문단으로 감싸고, 요소면 그대로 그린다
   * (스스로 수를 받아 0건이면 아무것도 그리지 않는 컴포넌트용 — {@link DeleteImpactNote}).
   */
  impact?: ReactNode;
  /** 확인창 본문(AlertDialogContent)의 data-testid — E2E 가 특정 확인창을 집을 때 */
  contentTestId?: string;
  /** 확인(삭제) 버튼의 data-testid */
  confirmTestId?: string;
}

/** 트리거 모드(트리거 버튼이 연다) 또는 controlled 모드(모바일 액션 시트처럼 트리거 밖에서 연다, WP-223) — 둘 중 하나만. */
type DeleteConfirmDialogProps = BaseProps & (
  | { trigger: ReactNode; open?: never; onOpenChange?: never }
  | { trigger?: never; open: boolean; onOpenChange: (open: boolean) => void }
);

export function DeleteConfirmDialog({
  entityName,
  itemName,
  onConfirm,
  trigger,
  open,
  onOpenChange,
  description,
  impact,
  contentTestId,
  confirmTestId,
}: DeleteConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger && (
        <AlertDialogTrigger asChild onClick={(e) => e.stopPropagation()}>
          {trigger}
        </AlertDialogTrigger>
      )}
      <AlertDialogContent onClick={(e) => e.stopPropagation()} data-testid={contentTestId}>
        <AlertDialogHeader>
          <AlertDialogTitle>{entityName} 삭제</AlertDialogTitle>
          <AlertDialogDescription>
            {description ?? (
              <>&quot;{itemName}&quot; {entityName}{eulReul(entityName)} 정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.</>
            )}
          </AlertDialogDescription>
          {typeof impact === 'string' ? <DeleteImpactNote note={impact} /> : impact}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          {/* 파괴적 작업임을 시각적으로 표시 — 실수 클릭 방지 */}
          <AlertDialogAction variant="destructive" onClick={onConfirm} data-testid={confirmTestId}>삭제</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** 삭제 확인창의 영향 안내 문단 — note 가 없으면(0건·모름) 그리지 않는다(WP-488). */
export function DeleteImpactNote({ note }: { note: string | null | undefined }) {
  if (!note) return null;
  return <p className="text-sm font-medium text-foreground" data-testid="delete-impact">{note}</p>;
}
