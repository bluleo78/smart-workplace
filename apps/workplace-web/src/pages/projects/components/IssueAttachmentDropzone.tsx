// 이슈 첨부 드롭존 — HTML5 native DnD + 클릭 업로드.
// disabled 일 때(이슈당 한도 도달)는 업로드를 하지 않고, 막힌 드롭·클릭에는 이유 토스트를 띄운다.

import { Loader2, Paperclip } from 'lucide-react';
import { useRef, useState } from 'react';

import { ATTACHMENT_MAX_PER_ISSUE } from '../../../api/issueAttachments';
import { useUploadIssueAttachments } from '../../../hooks/queries/useUploadIssueAttachments';
import { attachmentLimitLabel, notifyBlockedUpload } from '../../../lib/issueAttachmentUpload';
import { cn } from '../../../lib/utils';

export function IssueAttachmentDropzone({
  projectKey,
  number,
  currentCount,
  disabled,
}: {
  projectKey: string;
  number: number;
  currentCount: number;
  disabled: boolean;
}) {
  const upload = useUploadIssueAttachments(projectKey, number);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [hover, setHover] = useState(false);
  // 한도 도달 문구 또는 남은 5개 이하 힌트 — 한 번만 계산한다.
  const limitLabel = attachmentLimitLabel(currentCount, ATTACHMENT_MAX_PER_ISSUE);

  // 파일 처리 — disabled / 빈 입력은 무시. mutate 후 input 값 리셋해 같은 파일 재선택 가능.
  // 업로드 중에는 막는다 — 낡은 currentCount 로 두 번째 묶음이 잘못 잘리지 않게(WP-2118).
  // 막힌 이유 — 한도 도달이 업로드 중보다 우선. 커서·불투명도·토스트·dropEffect 를 여기서 파생한다.
  const blockReason: 'limit' | 'uploading' | null = disabled ? 'limit' : upload.isPending ? 'uploading' : null;
  const blocked = blockReason !== null;
  // 막힌 이유를 토스트로 알린다 — 드롭과 클릭이 같은 문구를 쓴다(클릭만 말없이 무시되지 않게, WP-2118).
  const notifyBlocked = (reason: 'limit' | 'uploading') => notifyBlockedUpload(reason, ATTACHMENT_MAX_PER_ISSUE);
  const onFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    // 막힌 때 드롭한 파일은 말없이 버리지 않고 이유를 알린다(WP-2118).
    if (blockReason) {
      notifyBlocked(blockReason);
      return;
    }
    upload.mutate({ files: Array.from(files), currentCount });
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div
      role="region"
      aria-label="첨부 드롭존"
      data-testid="attachment-dropzone"
      // dragover·drop 은 막힌 때(한도 도달·업로드 중)에도 늘 preventDefault — 안 하면 브라우저가 파일을 열어
      // 이슈 화면을 떠나 편집 내용을 잃는다. 막힌 때는 업로드만 건너뛴다(onFiles 가드).
      onDragOver={(e) => {
        e.preventDefault();
        // 막힌 때는 놓을 수 없다는 커서를 보인다(drop 은 위에서 preventDefault 해 파일 열기는 막는다).
        e.dataTransfer.dropEffect = blocked ? 'none' : 'copy';
        if (!blocked) setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        onFiles(e.dataTransfer.files);
      }}
      // 막힌 때는 input 이 disabled 라 클릭이 오지 않으므로 감싼 이 요소에서 받아 같은 안내를 띄운다.
      onClick={() => (blockReason ? notifyBlocked(blockReason) : inputRef.current?.click())}
      // 길고(flex-1) 두꺼운(py-4) 드롭 영역 — 점선 테두리로 "드롭/업로드"를 실선 링크 버튼과 구분.
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md border border-dashed border-input px-3 py-4 text-xs font-medium',
        blocked ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-accent',
        blockReason === 'limit' && 'opacity-50',
        hover ? 'bg-accent/40' : 'bg-background',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
        disabled={blocked}
      />
      {upload.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Paperclip className="h-3.5 w-3.5" />
      )}
      {disabled
        ? limitLabel
        : upload.isPending
          ? '업로드 중…'
          : '파일을 드롭하거나 클릭해 첨부'}
      {!disabled && !upload.isPending && limitLabel && <span className="text-muted-foreground">{limitLabel}</span>}
    </div>
  );
}
