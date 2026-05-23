// 이슈 첨부 1행 — 다운로드 트리거 + canDelete 시 삭제 버튼.

import { FileText, Image as ImageIcon, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { downloadAttachment } from '../../../api/issueAttachments';
import type { IssueAttachment } from '../../../types/attachment';

// 바이트 → 사람이 읽는 단위 (B/KB/MB).
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// MIME 으로 카테고리 아이콘 결정 — 이미지/기타 두 종류.
function categoryIcon(mime: string) {
  if (mime.startsWith('image/')) return <ImageIcon className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
}

export function IssueAttachmentItem({
  projectKey,
  number,
  attachment,
  canDelete,
  onDelete,
}: {
  projectKey: string;
  number: number;
  attachment: IssueAttachment;
  canDelete: boolean;
  onDelete: (fileId: number) => void;
}) {
  return (
    <li
      className="flex items-center gap-2 py-1 text-sm"
      data-testid={`attachment-row-${attachment.fileId}`}
    >
      {categoryIcon(attachment.mimeType)}
      <button
        type="button"
        className="font-medium hover:underline truncate flex-1 text-left"
        onClick={() =>
          downloadAttachment(projectKey, number, attachment.fileId, attachment.originalName)
        }
        aria-label={`${attachment.originalName} 다운로드`}
      >
        {attachment.originalName}
      </button>
      <span className="text-xs text-muted-foreground">{humanSize(attachment.sizeBytes)}</span>
      <span className="text-xs text-muted-foreground">{attachment.attachedByName}</span>
      {canDelete && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="첨부 삭제"
          onClick={() => onDelete(attachment.fileId)}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </li>
  );
}
