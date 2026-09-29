// 파일 버전 이력 모달(#79) — 버전 목록·다운로드·롤백.
// - 버전 목록 표시 (현재 버전 표식)
// - 개별 버전 다운로드
// - 이전 버전으로 롤백 (현재 버전 제외)

import { useEffect, useState } from 'react';

import { driveApi } from '@/api/drive';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDateTimeLocale, formatFileSize } from '@/lib/formatters';
import type { DriveFile, DriveFileVersion } from '@/types/drive';

interface Props {
  file: DriveFile;
  open: boolean;
  onClose: () => void;
  onChanged: () => void; // 롤백 후 목록 reload
}

/** 파일 버전 이력 모달(#79) — 버전 목록·다운로드·롤백. */
export function VersionHistoryModal({ file, open, onClose, onChanged }: Props) {
  const [versions, setVersions] = useState<DriveFileVersion[]>([]);
  const [busy, setBusy] = useState(false);
  // 롤백 확인 대기 중인 버전 번호 — null 이면 확인 다이얼로그 닫힘 (#815)
  const [pendingRollback, setPendingRollback] = useState<number | null>(null);

  // 모달 열릴 때(또는 파일 변경 시) 버전 목록 로드.
  async function load() {
    const { data } = await driveApi.listVersions(file.id);
    setVersions(data);
  }

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, file.id]);

  // 이전 버전으로 롤백 — 성공 시 목록 갱신 + 파일 목록 reload.
  async function onRollback(versionNo: number) {
    setBusy(true);
    try {
      await driveApi.rollbackVersion(file.id, versionNo);
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  // 확인 다이얼로그에서 "롤백" 클릭 시 실제 롤백 실행 (#815 — 즉시 실행 방지).
  async function confirmRollback() {
    if (pendingRollback == null) return;
    const versionNo = pendingRollback;
    setPendingRollback(null);
    await onRollback(versionNo);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent data-testid="version-history-modal">
          <DialogHeader>
            <DialogTitle>버전 이력 — {file.name}</DialogTitle>
          </DialogHeader>
          <ul className="divide-y">
            {versions.map((v) => (
              <li
                key={v.versionNo}
                className="flex items-center gap-2 py-2 text-sm"
                data-testid={`version-row-${v.versionNo}`}
              >
                <span className="font-medium">v{v.versionNo}</span>
                {v.current && (
                  <span className="rounded bg-primary/10 px-1 text-xs text-primary">현재</span>
                )}
                <span className="flex-1 truncate text-muted-foreground">
                  {v.uploadedByName} · {formatDateTimeLocale(v.createdAt)} ·{' '}
                  {formatFileSize(v.sizeBytes)}
                  {v.comment ? ` · ${v.comment}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => driveApi.downloadVersion(file.id, v.versionNo, file.name)}
                  className="text-xs text-primary"
                >
                  다운로드
                </button>
                {!v.current && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPendingRollback(v.versionNo)}
                    className="text-xs text-primary disabled:opacity-50"
                    data-testid={`rollback-${v.versionNo}`}
                  >
                    이 버전으로 롤백
                  </button>
                )}
              </li>
            ))}
          </ul>
          {/* 코너 X 버튼(sr-only "닫기")과 라벨 중복을 피하기 위해 하단 버튼은 앱 전역 컨벤션(#829)에 맞춰 "취소" 사용 */}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              취소
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* 롤백 확인 다이얼로그(#815) — 라벨/역할/그룹 삭제 등과 동일한 AlertDialog 패턴 재사용 */}
      <AlertDialog
        open={pendingRollback != null}
        onOpenChange={(v) => !v && setPendingRollback(null)}
      >
        <AlertDialogContent data-testid="rollback-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>버전으로 롤백</AlertDialogTitle>
            <AlertDialogDescription>
              v{pendingRollback}으로 롤백하시겠습니까? 현재 내용은 새 버전으로 보존됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction data-testid="rollback-confirm-action" onClick={confirmRollback}>
              롤백
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
