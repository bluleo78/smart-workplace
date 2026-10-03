// 모바일 「뷰 ▾」 시트(WP-194) — 저장된 뷰 목록 + 「완료 모두 보기」 + 「현재 조건으로 뷰 저장/업데이트」.
// 뷰 상태·dirty 판정은 데스크톱 ViewChipBar 와 같은 useSavedViewState 를 쓴다. 뷰 수정·삭제·고정은 데스크톱 전용.
import { Check, Plus, RefreshCw, Star, Users } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { MOBILE_SHEET_ROW as ROW, MobileSheetShell } from '@/components/mobile/MobileSheetShell';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import type { IssueFilterControls } from '../../hooks/useIssueFilterControls';
import type { SavedViewState } from '../../hooks/useSavedViewState';
import { SaveViewDialog } from '../SaveViewDialog';
import { SharedViewUpdateConfirm } from '../SharedViewUpdateConfirm';

export function MobileViewSheet({
  open,
  onClose,
  projectKey,
  controls,
  saved,
}: {
  open: boolean;
  onClose: () => void;
  projectKey: string;
  controls: IssueFilterControls;
  saved: SavedViewState;
}) {
  // 뷰 저장 다이얼로그 — 시트를 닫은 뒤 연다(시트·다이얼로그 동시 표시 금지).
  const [saveOpen, setSaveOpen] = useState(false);
  const activeView = saved.activeView;
  const closedChecked = controls.filters.showAllClosed || controls.closedHidingOverridden;
  // 저장할 조건이 없거나, 활성 뷰가 그대로면 「현재 조건으로 뷰 저장」 비활성.
  const saveDisabled = saved.hasNothingToSave || (!!activeView && !saved.isViewDirty);

  // 항목 선택 — 시트를 먼저 닫고 적용한다.
  const pick = (apply: () => void) => {
    onClose();
    apply();
  };
  const openSave = () => {
    onClose();
    setSaveOpen(true);
  };

  // 뷰 항목 한 줄 — 활성은 ✓, 공유는 👥, 고정은 ★.
  const option = (testId: string, label: ReactNode, active: boolean, onClick: () => void, extra?: ReactNode) => (
    <button
      key={testId}
      type="button"
      data-testid={testId}
      aria-current={active || undefined}
      onClick={onClick}
      className={cn(ROW, active && 'bg-accent font-medium')}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {extra}
      {active && <Check className="text-primary" aria-hidden="true" />}
    </button>
  );

  return (
    <>
      <MobileSheetShell
        open={open}
        onClose={onClose}
        title="뷰"
        description="저장된 뷰를 고르거나 현재 조건을 뷰로 저장하세요."
        testId="mobile-view-sheet"
      >
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {/* 「전체」 ✓ 는 툴바 뷰 칩 라벨과 같은 판정 — 에픽 범위만 걸린 상태도 전체로 본다. */}
          {option('mobile-view-option-all', '전체', saved.isAllActiveIgnoringEpic, () =>
            // 에픽 범위만 다른 상태는 이미 「전체」로 표시(✓)된다 — 탭해도 에픽 필터를 지우지 않는다(에픽은 칩 ✕ 로 해제).
            pick(() => {
              if (saved.isAllActive || !saved.isAllActiveIgnoringEpic) saved.applyAll();
            }),
          )}
          {saved.views.map((v) =>
            option(
              `mobile-view-option-${v.id}`,
              v.name,
              saved.isViewActive(v),
              () => pick(() => saved.apply(v.query)),
              <>
                {v.visibility === 'SHARED' && <Users className="text-muted-foreground" aria-label="공유" />}
                {v.pinned && <Star className="fill-current text-muted-foreground" aria-label="고정" />}
              </>,
            ),
          )}

          {controls.showClosedToggle && (
            <>
              <div className="my-1 border-t" />
              {/* 「완료 모두 보기」 — 시트를 닫지 않고 바로 토글. 명시 필터가 이미 숨김을 해제했으면 켜진 채 비활성(#876). */}
              {/* 행 전체가 label 이라 글자를 눌러도 스위치가 토글된다. 비활성은 행째 흐리게(스위치 자체 흐림은 꺼 이중 적용 방지). */}
              <label className={cn(ROW, 'has-disabled:opacity-50')}>
                <span className="min-w-0 flex-1">완료 모두 보기</span>
                <Switch
                  checked={closedChecked}
                  disabled={controls.closedHidingOverridden}
                  onCheckedChange={controls.toggleShowAllClosed}
                  data-testid="mobile-view-closed-toggle"
                  className="disabled:opacity-100"
                />
              </label>
            </>
          )}

          <div className="my-1 border-t" />
          {/* 저장 영역(#777 과 같은 규칙) — 활성 뷰가 바뀌었으면 업데이트/새로 저장, 아니면 현재 조건 저장. */}
          {activeView && saved.isViewDirty ? (
            <>
              <button
                type="button"
                data-testid="mobile-view-update"
                onClick={() => pick(() => saved.updateActiveView(activeView))}
                className={cn(ROW, 'text-primary')}
              >
                <RefreshCw aria-hidden="true" />
                뷰 업데이트
              </button>
              <button type="button" data-testid="mobile-view-save" onClick={openSave} className={ROW}>
                새 뷰로 저장
              </button>
            </>
          ) : (
            // 저장 가능하면 「＋ 에픽 만들기」 와 같은 primary 액션 모양(＋ 아이콘), 비활성이면 흐린 기본 행.
            <button
              type="button"
              data-testid="mobile-view-save"
              onClick={openSave}
              disabled={saveDisabled}
              className={cn(ROW, !saveDisabled && 'text-primary')}
            >
              <Plus aria-hidden="true" />
              현재 조건으로 뷰 저장
            </button>
          )}
        </div>
      </MobileSheetShell>

      {/* 열 때만 마운트 — 닫힌 다이얼로그를 상시 들고 있지 않는다. */}
      {saveOpen && <SaveViewDialog projectKey={projectKey} query={saved.currentQuery} open onOpenChange={setSaveOpen} />}

      {/* 공유 뷰 업데이트 확인 — ViewChipBar 와 같은 공용 컴포넌트. 데스크톱 바와 동시에 마운트되지 않는다. */}
      <SharedViewUpdateConfirm saved={saved} />
    </>
  );
}
