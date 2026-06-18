// 이슈 첨부 1행 — 다운로드 트리거 + canDelete 시 삭제 버튼.
// layout='strip' 이면 가로 칩 형태로 렌더(파일유형 아이콘 + 파일명 truncate).
// 무엇을: 목록(list)·칩 스트립(strip) 두 레이아웃을 prop 으로 분기.
// 왜: 본문 스트립 이동(#343) 시 동일 다운로드·삭제 기능을 칩 스타일로 재사용하기 위해.

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
  layout = 'list',
}: {
  projectKey: string;
  number: number;
  attachment: IssueAttachment;
  canDelete: boolean;
  onDelete: (fileId: number) => void;
  layout?: 'list' | 'strip';
}) {
  const handleDownload = () =>
    downloadAttachment(projectKey, number, attachment.fileId, attachment.originalName);

  // strip: 가로 칩 — 파일유형 아이콘 + 파일명(truncate) + 크기 + 삭제 버튼.
  if (layout === 'strip') {
    return (
      <li
        className="group inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs hover:bg-accent/50"
        data-testid={`attachment-row-${attachment.fileId}`}
      >
        {categoryIcon(attachment.mimeType)}
        <button
          type="button"
          className="max-w-[140px] truncate hover:underline text-left"
          onClick={handleDownload}
          aria-label={`${attachment.originalName} 다운로드`}
        >
          {attachment.originalName}
        </button>
        <span className="text-muted-foreground">{humanSize(attachment.sizeBytes)}</span>
        {canDelete && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="첨부 삭제"
            className="hidden group-hover:inline-flex h-4 w-4"
            onClick={() => onDelete(attachment.fileId)}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </li>
    );
  }

  // list: 기존 세로 목록 행.
  return (
    <li
      className="group flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent/50"
      data-testid={`attachment-row-${attachment.fileId}`}
    >
      {categoryIcon(attachment.mimeType)}
      <button
        type="button"
        className="font-medium hover:underline truncate flex-1 text-left"
        onClick={handleDownload}
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
          className="hidden group-hover:inline-flex"
          onClick={() => onDelete(attachment.fileId)}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </li>
  );
}
