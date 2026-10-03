// 이슈 첨부 1행 — 파일명 클릭 시 프리뷰, 다운로드 아이콘, canDelete 시 삭제 아이콘.
// layout='strip' 이면 가로 칩 형태로 렌더(파일유형 아이콘 + 파일명 truncate).
// 무엇을: 목록(list)·칩 스트립(strip) 두 레이아웃을 prop 으로 분기.
// 왜: 본문 스트립 이동(#343) 시 동일 프리뷰·다운로드·삭제 기능을 칩 스타일로 재사용하기 위해.
// WP-203: 파일명은 다운로드 대신 프리뷰를 연다. 다운로드·삭제 아이콘은 hover 없이 항상 노출한다
// (hover 전용이면 휴대폰·키보드에서 닿을 수 없음). 색은 보조 정보(크기)와 같은 muted 로 두어
// 주 동작(파일명)이 먼저 읽히게 한다.

import {
  Download,
  File as FileIcon,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  X,
} from 'lucide-react';

import { downloadAttachment } from '../../../api/issueAttachments';
import { formatFileSize } from '../../../lib/formatters';
import { resolvePreviewKind } from '../../../lib/previewKind';
import { cn } from '../../../lib/utils';
import type { IssueAttachment } from '../../../types/attachment';

/** 압축 파일 mime — 프리뷰 종류와 별개로 아이콘만 구분한다. */
const ARCHIVE_MIMES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/gzip',
  'application/x-tar',
]);

// MIME 으로 파일유형 아이콘 결정 — 이미지/표/문서/압축/기타.
function categoryIcon(mime: string) {
  const cls = 'h-4 w-4 shrink-0 text-muted-foreground';
  if (ARCHIVE_MIMES.has(mime)) return <FileArchive className={cls} aria-hidden />;
  switch (resolvePreviewKind(mime)) {
    case 'IMAGE':
      return <ImageIcon className={cls} aria-hidden />;
    case 'CSV':
    case 'XLSX':
      return <FileSpreadsheet className={cls} aria-hidden />;
    case 'UNSUPPORTED':
      return <FileIcon className={cls} aria-hidden />;
    default:
      return <FileText className={cls} aria-hidden />;
  }
}

// 칩 안 아이콘 버튼 — 기본 muted, 버튼 자신에 올렸을 때만 배경. 굵은 포인터(터치)에서는 터치 영역 확대.
const iconBtn =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-8 pointer-coarse:w-8';

export function IssueAttachmentItem({
  projectKey,
  number,
  attachment,
  canDelete,
  onDelete,
  onPreview,
  layout = 'list',
}: {
  projectKey: string;
  number: number;
  attachment: IssueAttachment;
  canDelete: boolean;
  onDelete: (fileId: number) => void;
  /** 파일명 클릭 — 프리뷰 모달 열기(모달 상태는 목록이 소유). */
  onPreview: (attachment: IssueAttachment) => void;
  layout?: 'list' | 'strip';
}) {
  const name = attachment.originalName;
  const handleDownload = () => downloadAttachment(projectKey, number, attachment.fileId, name);
  const strip = layout === 'strip';

  return (
    <li
      className={cn(
        'flex items-center gap-1.5 rounded',
        strip
          ? 'inline-flex border px-2 py-0.5 text-xs hover:bg-accent/50'
          : 'gap-2 px-1 py-1 text-sm hover:bg-accent/50',
      )}
      data-testid={`attachment-row-${attachment.fileId}`}
    >
      {categoryIcon(attachment.mimeType)}
      <button
        type="button"
        className={cn('truncate text-left hover:underline', strip ? 'max-w-[140px]' : 'flex-1 font-medium')}
        onClick={() => onPreview(attachment)}
        aria-label={`${name} 미리보기`}
        title={name}
      >
        {name}
      </button>
      <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
        {formatFileSize(attachment.sizeBytes)}
      </span>
      {!strip && <span className="text-xs text-muted-foreground">{attachment.attachedByName}</span>}
      <button
        type="button"
        className={iconBtn}
        onClick={handleDownload}
        aria-label={`${name} 다운로드`}
        title="다운로드"
      >
        <Download className="h-3.5 w-3.5" aria-hidden />
      </button>
      {canDelete && (
        <button
          type="button"
          className={cn(iconBtn, 'hover:text-destructive')}
          onClick={() => onDelete(attachment.fileId)}
          aria-label={`${name} 삭제`}
          title="삭제"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </li>
  );
}
