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

interface DeleteConfirmDialogProps {
  entityName: string;
  itemName: string;
  onConfirm: () => void;
  trigger: ReactNode;
  /** 기본 자동 생성 문구 대신 사용할 커스텀 설명. 미지정 시 자동 생성. */
  description?: ReactNode;
}

export function DeleteConfirmDialog({
  entityName,
  itemName,
  onConfirm,
  trigger,
  description,
}: DeleteConfirmDialogProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger}
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{entityName} 삭제</AlertDialogTitle>
          <AlertDialogDescription>
            {description ?? (
              <>&quot;{itemName}&quot; {entityName}{eulReul(entityName)} 정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.</>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          {/* 파괴적 작업임을 시각적으로 표시 — 실수 클릭 방지 */}
          <AlertDialogAction variant="destructive" onClick={onConfirm}>삭제</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
