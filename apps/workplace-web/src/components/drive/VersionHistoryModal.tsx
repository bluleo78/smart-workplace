// 파일 버전 이력 모달(#79) — 버전 목록·다운로드·롤백.
// - 버전 목록 표시 (현재 버전 표식)
// - 개별 버전 다운로드
// - 이전 버전으로 롤백 (현재 버전 제외)

import { useEffect, useState } from 'react';

import { driveApi } from '@/api/drive';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

  return (
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
                {v.uploadedByName} · {new Date(v.createdAt).toLocaleString()} ·{' '}
                {Math.round(v.sizeBytes / 1024)}KB
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
                  onClick={() => onRollback(v.versionNo)}
                  className="text-xs text-primary disabled:opacity-50"
                  data-testid={`rollback-${v.versionNo}`}
                >
                  이 버전으로 롤백
                </button>
              )}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
