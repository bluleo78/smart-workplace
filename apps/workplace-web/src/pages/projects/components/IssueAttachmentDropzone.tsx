// 이슈 첨부 드롭존 — HTML5 native DnD + 클릭 업로드.
// disabled 일 때(이슈당 한도 도달)는 업로드를 하지 않고, 막힌 드롭·클릭에는 이유 토스트를 띄운다.
// 키보드(WP-2130): button 역할 + Tab 초점 + Enter·Space 로 클릭과 같이 동작한다.

import { Loader2, Paperclip } from 'lucide-react';
import { useId, useRef, useState } from 'react';

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
  // 상태 문구 span 의 id — aria-label 이 보이는 문구를 가려 버리므로 설명(describedby)으로 이어 낭독되게 한다(WP-2130).
  const statusId = useId();
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

  // 한도 도달 흐림 — 아이콘·상태 문구에 함께 준다(루트에는 주지 않는다, 아래 주석).
  const dim = blockReason === 'limit' && 'opacity-50';
  const StatusIcon = upload.isPending ? Loader2 : Paperclip;

  // 클릭·키보드 공통 동작 — 막힌 때는 이유 토스트, 아니면 파일 선택창을 연다.
  // 막힌 때도 초점은 받게(tabIndex 0) 두어 키보드·스크린리더 사용자도 같은 안내를 듣는다.
  const activate = () => (blockReason ? notifyBlocked(blockReason) : inputRef.current?.click());

  return (
    <div
      role="button"
      aria-label="첨부 드롭존"
      aria-describedby={statusId}
      tabIndex={0}
      aria-disabled={blocked}
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
      onClick={activate}
      // Enter·Space 는 클릭과 같게 — Space 의 페이지 스크롤을 막으려 기본 동작을 먼저 취소하고,
      // 키를 누르고 있어 오는 반복(repeat)은 토스트·선택창이 연달아 뜨지 않게 무시한다.
      // Ctrl·Alt·Meta 를 함께 누른 키는 다른 단축키라 건드리지 않는다(네이티브 버튼과 같게).
      // (공용 clickableRowProps 는 ref 를 쓰는 activate 를 렌더 중에 넘기면 react-hooks/refs 에 걸려 쓰지 않는다.)
      onKeyDown={(e) => {
        // 드롭존 자신에서 누른 키만 받는다 — 지금 자식(숨은 input·span)은 초점을 받지 않지만, 나중에 초점 받는
        // 자식이 생기면 그 키를 가로채 기본 동작을 취소하고 드롭존이 대신 열리지 않게 미리 막는다(WP-1555 와 같은 이유).
        if (e.target !== e.currentTarget) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        e.preventDefault();
        if (e.repeat) return;
        activate();
      }}
      // 길고(flex-1) 두꺼운(py-4) 드롭 영역 — 점선 테두리로 "드롭/업로드"를 실선 링크 버튼과 구분.
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md border border-dashed border-input px-3 py-4 text-xs font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        blocked ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-accent',
        // 한도 도달은 테두리만 흐리게 — 루트 opacity 는 초점 링까지 흐려 쓰지 않는다(WP-2130).
        blockReason === 'limit' && 'border-input/50',
        hover ? 'bg-accent/40' : 'bg-background',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        // input.click() 이 만든 클릭이 감싼 div 의 onClick(activate)로 되올라와 다시 click() 하는 되먹임을 끊는다.
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onFiles(e.target.files)}
        disabled={blocked}
      />
      {/* 한도 도달 흐림은 루트가 아니라 내용(아이콘·문구)에만 준다 — 루트를 흐리면 초점 링까지 흐려져 막힌 상태의 초점이 안 보이므로(WP-2130). */}
      <StatusIcon className={cn('h-3.5 w-3.5', upload.isPending && 'animate-spin', dim)} />
      <span id={statusId} className={cn('flex items-center gap-1.5', dim)}>
        {disabled
          ? limitLabel
          : upload.isPending
            ? '업로드 중…'
            : '파일을 드롭하거나 클릭해 첨부'}
        {!disabled && !upload.isPending && limitLabel && <span className="text-muted-foreground">{limitLabel}</span>}
      </span>
    </div>
  );
}
