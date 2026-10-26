// 버전 행·카드의 ⋯ 메뉴(WP-888) — 편집·출시/출시 취소·보관/복원·삭제(보관한 행만). 데스크톱은 드롭다운, 모바일 폭은 액션 시트.
// 어떤 동작이 보이는지는 versionRowActions(순수 함수)가 정하고, 여기선 항목을 그리고 호출부 콜백에 잇는다.
import { Archive, ArchiveRestore, Pencil, Rocket, Trash2, Undo2 } from 'lucide-react';

import type { MobileSheetAction } from '@/components/mobile/MobileActionSheet';
import { TouchRowActionsMenu } from '@/components/mobile/TouchRowActionsMenu';

import { type VersionRowAction, versionRowActions } from '../../../lib/versions';
import type { VersionResponse } from '../../../types/version';

export interface VersionRowHandlers {
  onEdit: (v: VersionResponse) => void;
  onRelease: (v: VersionResponse) => void;
  onUnrelease: (v: VersionResponse) => void;
  onArchive: (v: VersionResponse) => void;
  onRestore: (v: VersionResponse) => void;
  onDelete: (v: VersionResponse) => void;
}

const META: Record<VersionRowAction, { label: string; icon: React.ReactNode; destructive?: boolean }> = {
  edit: { label: '편집', icon: <Pencil /> },
  release: { label: '출시', icon: <Rocket /> },
  unrelease: { label: '출시 취소', icon: <Undo2 /> },
  archive: { label: '보관', icon: <Archive /> },
  restore: { label: '복원', icon: <ArchiveRestore /> },
  delete: { label: '삭제', icon: <Trash2 />, destructive: true },
};

/** 관리 권한이 없거나 할 수 있는 동작이 없으면 아무것도 그리지 않는다. */
export function VersionRowMenu({
  version,
  canManage,
  handlers,
}: {
  version: VersionResponse;
  canManage: boolean;
  handlers: VersionRowHandlers;
}) {
  const keys = versionRowActions(version, canManage);
  if (keys.length === 0) return null;
  const call: Record<VersionRowAction, () => void> = {
    edit: () => handlers.onEdit(version),
    release: () => handlers.onRelease(version),
    unrelease: () => handlers.onUnrelease(version),
    archive: () => handlers.onArchive(version),
    restore: () => handlers.onRestore(version),
    delete: () => handlers.onDelete(version),
  };
  const actions: MobileSheetAction[] = keys.map((k) => ({
    key: k,
    label: META[k].label,
    icon: META[k].icon,
    destructive: META[k].destructive,
    onSelect: call[k],
  }));
  return (
    <TouchRowActionsMenu
      title={version.name}
      testId={`version-menu-${version.id}`}
      actions={actions}
      itemTestId={(key) => `version-action-${key}`}
      sheetTestId="version-sheet"
    />
  );
}
