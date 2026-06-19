// 이름 변경 Dialog — window.prompt() 대체용 재사용 컴포넌트 (#160).
// trigger 없이 open/onClose prop 으로 제어하는 제어 컴포넌트 방식.

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';

interface RenameDialogProps {
  /** 다이얼로그 열림 여부 */
  open: boolean;
  /** 제목 (예: "라벨 이름 변경") */
  title: string;
  /** 초기 값 (현재 이름) */
  initialValue: string;
  /** 확인 클릭 시 새 이름 전달. 빈 문자열이면 호출 안 됨. */
  onConfirm: (newName: string) => void;
  /** 취소/외부 클릭 시 닫힘 콜백 */
  onClose: () => void;
}

export function RenameDialog({
  open,
  title,
  initialValue,
  onConfirm,
  onClose,
}: RenameDialogProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // 다이얼로그가 열릴 때마다 초기값 동기화 + 포커스
  useEffect(() => {
    if (open) {
      setValue(initialValue);
      // 렌더 후 포커스 — setTimeout 으로 DOM 안정화 대기
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, initialValue]);

  function handleConfirm() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
          maxLength={40}
          data-testid="rename-dialog-input"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button onClick={handleConfirm} disabled={!value.trim()} data-testid="rename-dialog-confirm">
            확인
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
