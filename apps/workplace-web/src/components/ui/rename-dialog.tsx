// 이름 변경 Dialog — window.prompt() 대체용 재사용 컴포넌트 (#160).
// trigger 없이 open/onClose prop 으로 제어하는 제어 컴포넌트 방식.

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSingleLineEnter } from '@/hooks/useSingleLineEnter';

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
  /**
   * 확인 클릭 시 새 이름 전달. 빈 문자열이면 호출 안 됨.
   * Promise 를 반환하면(비동기 API 호출) 완료까지 대기 후 닫고, reject 되면 다이얼로그를
   * 유지한 채 인라인 에러로 표시한다(#696 — 컨테이너류 이름 중복 하드 차단 정책과 함께 도입).
   * 동기 함수(기존 호출부)는 그대로 즉시 닫힘 동작을 유지한다.
   */
  onConfirm: (newName: string) => void | Promise<void>;
  /** 취소/외부 클릭 시 닫힘 콜백 */
  onClose: () => void;
  /** reject 된 에러에서 표시할 메시지를 추출 — 미지정 시 인라인 에러를 표시하지 않고 그대로 전파(throw)한다. */
  extractError?: (error: unknown) => string;
  /** 확인 버튼 라벨 — 기본 "확인" */
  confirmLabel?: string;
  /** 입력 최대 길이 — 기본 40 */
  maxLength?: number;
  /**
   * 열릴 때 처음 선택할 범위 [시작, 끝] — 미지정 시 선택 없이 커서를 끝에 둔다. 파일 이름에서 확장자 앞까지만 선택할 때 쓴다(WP-335).
   * 고치기 전이면 포커스를 받을 때마다 다시 건다.
   */
  initialSelection?: (value: string) => [number, number];
}

/** initialSelection 미지정 시 — 선택 없이 커서를 끝에 둔다. */
const caretAtEnd = (value: string): [number, number] => [value.length, value.length];

export function RenameDialog({
  open,
  title,
  initialValue,
  onConfirm,
  onClose,
  extractError,
  confirmLabel = '확인',
  maxLength = 40,
  initialSelection = caretAtEnd,
}: RenameDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 열린 뒤 고쳤는지 — 고친 뒤엔 포커스를 되찾아도 처음 선택을 다시 걸지 않는다.
  const [dirty, setDirty] = useState(false);
  // Enter 확인 — 한글 조합 Enter·macOS Chrome 확정 직후 꼬리 Enter 는 확인으로 보지 않는다(WP-331).
  const enterKey = useSingleLineEnter();

  // 열리는 렌더에서 바로 초기값을 맞춘다 — 효과로 맞추면 Radix 자동 포커스(자식 효과)가 빈 값을 보고, 그걸 고치려 두었던 늦은
  // 포커스 타이머가 부하에서 사용자가 친 글자를 덮어썼다. 열린 동안 initialValue 가 바뀌어도 고치던 값은 그대로 둔다.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setValue(initialValue);
      setDirty(false);
      setError(null);
      setSubmitting(false);
    }
  }

  async function handleConfirm() {
    const trimmed = value.trim();
    if (!trimmed || submitting) return;
    setError(null);
    try {
      // onConfirm 이 Promise 를 반환하지 않는 기존 호출부는 즉시 resolve 되어 아래 onClose 로 이어진다.
      setSubmitting(true);
      await onConfirm(trimmed);
      onClose();
    } catch (err) {
      if (!extractError) throw err;
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        <Input
          value={value}
          onChange={(e) => { setValue(e.target.value); setDirty(true); setError(null); }}
          onFocus={(e) => {
            // 고치기 전, 전체 선택으로 포커스를 받았을 때만 처음 선택 범위로 좁힌다. Radix 포커스 트랩은 열 때와 (⋯ 메뉴가 잠깐 가져간)
            // 포커스를 되찾을 때 focus() 직후 같은 호출에서 select() 하므로, 그 뒤·사용자 입력 전에 도는 마이크로태스크에서 본다.
            const el = e.currentTarget;
            if (dirty) return;
            queueMicrotask(() => {
              if (el.selectionStart === 0 && el.selectionEnd === el.value.length) {
                el.setSelectionRange(...initialSelection(el.value));
              }
            });
          }}
          onCompositionEnd={enterKey.onCompositionEnd}
          onKeyDown={(e) => enterKey.handleEnter(e, () => void handleConfirm())}
          maxLength={maxLength}
          aria-invalid={!!error}
          data-testid="rename-dialog-input"
        />
        {error && (
          <p className="text-sm text-destructive" data-testid="rename-dialog-error">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            onClick={() => void handleConfirm()}
            disabled={!value.trim() || submitting}
            data-testid="rename-dialog-confirm"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
