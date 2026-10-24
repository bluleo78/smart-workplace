// 모바일 보드 현재 탭 ⋯ → 바텀시트(WP-808, 모바일 A안) — OWNER 에게만: 「이름 변경」「이 뒤에 상태 추가」「상태 관리…」(WP-809, 설정 「상태」 섹션).
// 데스크톱 컬럼 헤더 ⋯ 메뉴(BoardColumnHeaderMenu)와 같은 항목이다. 액션은 MobileActionSheet, 이름 입력은 MobileSheetShell 안의
// 공용 StatusNameEditor(빈 이름·30자·중복·서버 오류를 입력 아래에 보인다). 새 상태의 범주는 현재 탭 범주 — 위치로 정해진다.
import { MoreHorizontal, Pencil, Plus, Settings2 } from 'lucide-react';
import { useState } from 'react';

import { MobileActionSheet } from '@/components/mobile/MobileActionSheet';
import { MobileSheetShell } from '@/components/mobile/MobileSheetShell';
import { Button } from '@/components/ui/button';
import { ISSUE_STATUS_LABEL } from '@/lib/issueGrouping';
import { statusAddBlockedReason } from '@/lib/projectStatuses';
import type { ProjectStatus } from '@/types/projectStatus';

import { StatusNameEditor } from './StatusNameEditor';

// 열린 시트 — 액션 목록 → 이름 입력. 한 번에 한 시트만 열린다.
type Step = 'actions' | 'name' | null;

export function MobileStatusSheet({
  status,
  canEdit,
  statuses,
  onRename,
  onAddAfter,
  onManage,
}: {
  // 현재 탭의 상태.
  status: ProjectStatus;
  canEdit: boolean;
  // 이름 중복 검사·상한(20개) 판정용 상태 목록.
  statuses: ProjectStatus[];
  // 이 상태 이름을 바꾼다 — 실패하면 reject(입력기가 오류를 보인다).
  onRename: (name: string) => Promise<void>;
  // 이 상태 바로 뒤(같은 범주)에 새 상태를 만든다 — 실패하면 reject.
  onAddAfter: (name: string) => Promise<void>;
  // 설정 「상태」 섹션으로 간다 — 없으면 항목을 그리지 않는다.
  onManage?: () => void;
}) {
  const [step, setStep] = useState<Step>(null);
  // 이름 입력 시트의 용도 — 닫히는 애니메이션 동안에도 제목이 바뀌지 않게 step 과 따로 둔다.
  const [mode, setMode] = useState<'rename' | 'add'>('add');
  if (!canEdit) return null;
  const category = ISSUE_STATUS_LABEL[status.category];
  const addBlocked = statusAddBlockedReason(statuses);
  const close = () => setStep(null);
  const openName = (m: 'rename' | 'add') => {
    setMode(m);
    setStep('name');
  };
  const rename = mode === 'rename';
  return (
    <>
      {/* ⋯ — 호버 없이 늘 보이는 44px 터치 타깃. */}
      <Button
        variant="ghost"
        size="icon"
        className="size-11 shrink-0 text-muted-foreground"
        aria-label={`${status.name} 상태 메뉴`}
        onClick={() => setStep('actions')}
        data-testid="board-tab-menu"
      >
        <MoreHorizontal className="size-5" />
      </Button>
      <MobileActionSheet
        open={step === 'actions'}
        onClose={close}
        title={`「${status.name}」 · 범주 ${category}`}
        description={`${status.name} 상태 편집`}
        testId="mobile-status-sheet"
        actions={[
          { key: 'status-rename', label: '이름 변경', icon: <Pencil />, onSelect: () => openName('rename') },
          // 상한(20개)이면 흐리게 막고 이유를 행 오른쪽에 보인다(설정 「+ 추가」와 같은 문구).
          {
            key: 'status-add-after',
            label: '이 뒤에 상태 추가',
            icon: <Plus />,
            onSelect: () => openName('add'),
            disabled: !!addBlocked,
            hint: addBlocked,
          },
          ...(onManage ? [{ key: 'status-manage', label: '상태 관리…', icon: <Settings2 />, onSelect: onManage }] : []),
        ]}
      />
      <MobileSheetShell
        open={step === 'name'}
        onClose={close}
        title={rename ? '이름 변경' : '새 상태'}
        description={rename ? `${status.name} 상태의 새 이름을 입력하세요` : `${status.name} 뒤에 만들 상태 이름을 입력하세요`}
        testId="mobile-status-name-sheet"
        headerAction={<span className="min-w-0 truncate text-sm text-muted-foreground">범주 {category}</span>}
        autoFocus
      >
        {/* 시트 내용은 닫히면 언마운트된다 — 열 때마다 새 입력기라 이전 입력·오류가 남지 않는다. */}
        <StatusNameEditor
          initial={rename ? status.name : ''}
          statuses={statuses}
          excludeId={rename ? status.id : undefined}
          submitLabel={rename ? '저장' : '추가'}
          touch
          className="px-4 pb-4 pt-1"
          onSubmit={async (name) => {
            await (rename ? onRename(name) : onAddAfter(name));
            close();
          }}
          onCancel={close}
        />
      </MobileSheetShell>
    </>
  );
}
