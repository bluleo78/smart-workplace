// 이슈 첨부 드롭존 — HTML5 native DnD + 클릭 업로드.
// disabled 일 때(이슈당 한도 도달) 드롭/클릭 모두 비활성.

import { Paperclip } from 'lucide-react';
import { useRef, useState } from 'react';

import { useUploadIssueAttachments } from '../../../hooks/queries/useUploadIssueAttachments';

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

  // 파일 처리 — disabled / 빈 입력은 무시. mutate 후 input 값 리셋해 같은 파일 재선택 가능.
  const onFiles = (files: FileList | null) => {
    if (!files || files.length === 0 || disabled) return;
    upload.mutate({ files: Array.from(files), currentCount });
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div
      role="region"
      aria-label="첨부 드롭존"
      data-testid="attachment-dropzone"
      onDragOver={(e) => {
        if (!disabled) {
          e.preventDefault();
          setHover(true);
        }
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        onFiles(e.dataTransfer.files);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`mt-2 cursor-pointer rounded-md border border-dashed p-3 text-center text-sm ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      } ${hover ? 'bg-accent/40' : 'bg-card'}`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
        disabled={disabled}
      />
      <Paperclip className="mx-auto h-4 w-4 mb-1" />
      {disabled ? '한도 도달' : upload.isPending ? '업로드 중…' : '파일을 드롭하거나 클릭해 첨부'}
    </div>
  );
}
