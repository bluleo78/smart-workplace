import { type DragEvent, useRef, useState } from 'react';

import { isFileDrag } from '@/lib/clipboardFiles';

/**
 * 채팅 입력창 영역을 파일 드롭 영역으로 만드는 훅 (WP-235). 반환한 dropProps 를 입력창 래퍼에 펼치고,
 * isDragging 으로 "여기에 놓아 첨부" 오버레이를 띄운다. 에디터 위에 떨어뜨린 드롭도 버블링으로 여기서 받는다
 * (RichInput 에 onFiles 를 주면 파일 드롭은 ProseMirror 기본 처리를 막고 넘긴다).
 * 자식 요소를 오갈 때마다 dragenter/leave 가 짝으로 발생하므로 깊이 카운터로 진입 여부를 판정한다.
 * 텍스트 드래그는 건드리지 않는다(에디터 기본 동작 유지).
 */
export function useComposerFileDrop(onFiles: (files: File[]) => void) {
  const [isDragging, setIsDragging] = useState(false);
  const depth = useRef(0);

  const dropProps = {
    onDragEnter: (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      depth.current += 1;
      setIsDragging(true);
    },
    onDragOver: (e: DragEvent) => {
      // dragover 를 막아야 drop 이 발생한다.
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setIsDragging(false);
    },
    onDrop: (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      depth.current = 0;
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onFiles(files);
    },
  };

  return { isDragging, dropProps };
}
