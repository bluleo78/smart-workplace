// 채팅 입력창 위 첨부 대기 칩 목록 — 사전 업로드한 파일 칩 + 드라이브 링크 칩(#80). 메시징·이슈 챗 공용(WP-235).
// 첨부가 없으면 아무것도 렌더하지 않는다.
import { Cloud, Loader2, X } from 'lucide-react';

import { splitName } from '@/components/viewer/viewerNav';
import type { PendingDriveFile, PendingFile } from '@/hooks/useAttachmentDraft';
import { HIT_AREA } from '@/lib/hitArea';

/**
 * 칩 파일명 — 앞부분(head)만 말줄임하고 꼬리(확장자 포함)는 늘 보인다.
 * 왜(WP-1858): 통째로 truncate 하면 앞부분이 같은 긴 이름이 같아 보여 엉뚱한 파일을 빼게 된다.
 * MessageAttachmentList 의 CardName·메일 첨부 칩과 같은 splitName 규칙. 전체 이름은 title 로 둔다.
 * whitespace-pre: 경계의 공백이 flex 항목 가장자리에서 사라지지 않게 한다.
 */
function ChipName({ name }: { name: string }) {
  const [head, tail] = splitName(name);
  return (
    <span className="flex min-w-0 max-w-[10rem]" title={name} data-testid="attachment-chip-name">
      <span className="min-w-0 truncate whitespace-pre">{head}</span>
      <span className="shrink-0 whitespace-pre" data-testid="attachment-chip-name-tail">
        {tail}
      </span>
    </span>
  );
}

export function ComposerAttachmentChips({
  testIdPrefix,
  pending,
  pendingDrive = [],
  onRemoveFile,
  onRemoveDrive,
  uploadingNames = [],
}: {
  /** testid 접두사 — 메시징 'composer', 이슈 챗 'chat-composer'(기존 E2E 와 같은 id). */
  testIdPrefix: string;
  pending: PendingFile[];
  /** 드라이브 링크 칩 — 드라이브를 받지 않는 메인 AI 채팅(WP-234)은 생략한다(기본 빈 목록). */
  pendingDrive?: PendingDriveFile[];
  onRemoveFile: (fileId: number) => void;
  /** 드라이브 칩 × — pendingDrive 를 넘길 때만 필요하다. */
  onRemoveDrive?: (driveFileId: number) => void;
  /** 업로드 중인 파일 이름 — 스피너 칩으로 보인다(메인 AI 채팅, WP-234). 기본 빈 목록이라 메시징·이슈 챗은 그대로. */
  uploadingNames?: string[];
}) {
  if (pending.length === 0 && pendingDrive.length === 0 && uploadingNames.length === 0) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-2" data-testid={`${testIdPrefix}-attachments`}>
      {/* 칩 li 세 종류 모두 min-w-0 max-w-full — 좁은 컨테이너에서 칩이 행보다 넓어지지 않게(메일 첨부 칩과 같게). */}
      {pending.map((p) => (
        <li key={p.fileId} className="flex min-w-0 max-w-full items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs">
          <ChipName name={p.originalName} />
          {/* WP-1865 — 칩이 여럿이어도 어느 파일을 빼는지 읽히게 접근 이름에 (잘리지 않은) 파일명을 넣는다. */}
          <button type="button" aria-label={`${p.originalName} 첨부 제거`} className={HIT_AREA} onClick={() => onRemoveFile(p.fileId)}>
            <X className="h-3 w-3" />
          </button>
        </li>
      ))}
      {pendingDrive.map((d) => (
        <li
          key={d.driveFileId}
          data-testid={`${testIdPrefix}-drive-chip-${d.driveFileId}`}
          className="flex min-w-0 max-w-full items-center gap-1 rounded-md border bg-info-subtle px-2 py-1 text-xs text-info-text"
        >
          <Cloud className="h-3 w-3" />
          <ChipName name={d.name} />
          {/* WP-1865 — 어느 드라이브 파일의 링크를 빼는지 접근 이름에 파일명을 넣는다. */}
          <button
            type="button"
            aria-label={`${d.name} 드라이브 링크 제거`}
            className={HIT_AREA}
            onClick={() => onRemoveDrive?.(d.driveFileId)}
          >
            <X className="h-3 w-3" />
          </button>
        </li>
      ))}
      {uploadingNames.map((name, i) => (
        <li
          key={`uploading-${i}`}
          aria-busy="true"
          data-testid={`${testIdPrefix}-uploading-chip`}
          className="flex min-w-0 max-w-full items-center gap-1 rounded-md border border-dashed bg-card px-2 py-1 text-xs text-muted-foreground"
        >
          <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden />
          <ChipName name={name} />
          <span className="sr-only">업로드 중</span>
        </li>
      ))}
    </ul>
  );
}
