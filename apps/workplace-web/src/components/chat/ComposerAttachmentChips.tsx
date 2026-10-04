// 채팅 입력창 위 첨부 대기 칩 목록 — 사전 업로드한 파일 칩 + 드라이브 링크 칩(#80). 메시징·이슈 챗 공용(WP-235).
// 첨부가 없으면 아무것도 렌더하지 않는다.
import { Cloud, X } from 'lucide-react';

import type { PendingDriveFile, PendingFile } from '@/hooks/useAttachmentDraft';
import { HIT_AREA } from '@/lib/hitArea';

export function ComposerAttachmentChips({
  testIdPrefix,
  pending,
  pendingDrive,
  onRemoveFile,
  onRemoveDrive,
}: {
  /** testid 접두사 — 메시징 'composer', 이슈 챗 'chat-composer'(기존 E2E 와 같은 id). */
  testIdPrefix: string;
  pending: PendingFile[];
  pendingDrive: PendingDriveFile[];
  onRemoveFile: (fileId: number) => void;
  onRemoveDrive: (driveFileId: number) => void;
}) {
  if (pending.length === 0 && pendingDrive.length === 0) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-2" data-testid={`${testIdPrefix}-attachments`}>
      {pending.map((p) => (
        <li key={p.fileId} className="flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs">
          <span className="max-w-[10rem] truncate">{p.originalName}</span>
          <button type="button" aria-label="첨부 제거" className={HIT_AREA} onClick={() => onRemoveFile(p.fileId)}>
            <X className="h-3 w-3" />
          </button>
        </li>
      ))}
      {pendingDrive.map((d) => (
        <li
          key={d.driveFileId}
          data-testid={`${testIdPrefix}-drive-chip-${d.driveFileId}`}
          className="flex items-center gap-1 rounded-md border bg-info-subtle px-2 py-1 text-xs text-info"
        >
          <Cloud className="h-3 w-3" />
          <span className="max-w-[10rem] truncate">{d.name}</span>
          <button
            type="button"
            aria-label="드라이브 링크 제거"
            className={HIT_AREA}
            onClick={() => onRemoveDrive(d.driveFileId)}
          >
            <X className="h-3 w-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}
