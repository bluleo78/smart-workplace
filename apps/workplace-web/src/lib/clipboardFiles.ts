// 붙여넣기·드롭 이벤트에서 "첨부로 올릴 파일"을 꺼내는 순수 판정 (WP-235).
// 채팅 입력창(RichInput)의 paste 처리·useComposerFileDrop 과 단위 테스트가 공유한다.
import { clipboardHasText } from '@/lib/imageUpload';

/**
 * 붙여넣기 데이터에서 첨부할 파일 목록. 기본 붙여넣기가 넣을 텍스트가 있으면 빈 배열 — 텍스트 붙여넣기로 둔다.
 * 워드·엑셀·키노트 등은 복사한 텍스트의 렌더링 이미지(PNG)를 files 에 함께 실어, 파일을 우선하면
 * 글을 붙여넣으려다 의도치 않은 이미지가 첨부된다. 텍스트 판정은 위키·이슈 이미지 붙여넣기와 같은 clipboardHasText.
 */
export function filesFromPaste(data: DataTransfer | null | undefined): File[] {
  if (!data || data.files.length === 0) return [];
  if (clipboardHasText(data)) return [];
  return Array.from(data.files);
}

/** 드래그 중인 데이터에 파일이 있는지 — dragenter/over 시점엔 files 가 비어 있어 types 의 'Files' 로 판정한다. */
export function isFileDrag(data: Pick<DataTransfer, 'types'> | null | undefined): boolean {
  return !!data && data.types.includes('Files');
}
