/**
 * 본문 이미지 크기·테두리 — 본래 크기, 칸 폭·높이 480px 를 넘으면 비율 유지로 줄인다.
 * 보기 화면(IssueBodyImage)과 편집칸 이미지(RichBodyImageNodeView, WP-1656)가 같은 크기로 그리도록 함께 쓴다
 * (여백 my-2·확대 커서는 보기 화면만 더한다).
 * 상수만 따로 둔 파일이다 — IssueBodyImage 는 첨부 뷰어(AttachmentViewer)를 함께 불러오므로, 편집칸이 거기서 가져오면
 * 코멘트·채팅·메일 입력창 번들까지 뷰어가 끌려 들어간다(PR #1413 리뷰).
 */
export const ISSUE_BODY_IMAGE_CLASS = 'block h-auto max-h-[480px] max-w-full rounded-md border border-border'
