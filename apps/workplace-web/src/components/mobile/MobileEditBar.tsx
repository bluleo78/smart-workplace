// 모바일 편집 바(WP-196) — 제목·본문 편집 중 코멘트 입력 자리를 대신해 키보드 바로 위에 [취소 · 저장].
// 버튼은 pointerdown/mousedown 기본 동작을 막아 입력칸 포커스(=키보드)를 유지한다 — 탭 순간 blur 가 먼저 일어나
// 저장/취소와 경합하지 않게(R5).
import { Button } from '@/components/ui/button';
import { keepFocusProps } from '@/lib/keepFocus';

export interface EditBarControls {
  save: () => void;
  cancel: () => void;
  /** 업로드 중·요청 중 등 저장·취소 불가. */
  disabled: boolean;
}

export function MobileEditBar({ controls }: { controls: EditBarControls }) {
  return (
    <div className="flex items-center justify-end gap-2" data-testid="mobile-edit-bar">
      <Button
        type="button"
        variant="ghost"
        className="h-11 px-4"
        disabled={controls.disabled}
        {...keepFocusProps}
        onClick={controls.cancel}
        data-testid="mobile-edit-cancel"
      >
        취소
      </Button>
      <Button
        type="button"
        className="h-11 px-5"
        disabled={controls.disabled}
        {...keepFocusProps}
        onClick={controls.save}
        data-testid="mobile-edit-save"
      >
        저장
      </Button>
    </div>
  );
}
