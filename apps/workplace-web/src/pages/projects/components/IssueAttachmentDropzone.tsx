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
      // 길고(flex-1) 두꺼운(py-4) 드롭 영역 — 점선 테두리로 "드롭/업로드"를 실선 링크 버튼과 구분.
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border border-dashed border-input px-3 py-4 text-xs font-medium ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-accent'
      } ${hover ? 'bg-accent/40' : 'bg-background'}`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
        disabled={disabled}
      />
      <Paperclip className="h-3.5 w-3.5" />
      {disabled ? '한도 도달' : upload.isPending ? '업로드 중…' : '파일을 드롭하거나 클릭해 첨부'}
    </div>
  );
}
