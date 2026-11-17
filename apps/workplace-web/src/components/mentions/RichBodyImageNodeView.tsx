// 본문 모드 RichInput 이미지 노드뷰(WP-1656) — 이슈 본문 편집칸 안 이미지를 저장 뒤 보기 화면(IssueBodyImage)과 같은 크기로 그린다.
// 본래 크기로 두고 칸 폭·높이 480px 를 넘을 때만 비율을 지켜 줄인다(작은 이미지는 늘리지 않음) — 저장 전후 이미지 크기가 바뀌지 않게.
// 업로드 중·실패·불러오는 중 상자는 코멘트 입력창과 같은 모양(UploadImageNodeView)이고, 코멘트 입력창 썸네일(THUMB)은 그대로다.
import type { ReactNodeViewProps } from '@tiptap/react'

import { ISSUE_BODY_IMAGE_CLASS } from '../issue/issueBodyImageClass'
import { UploadImageNodeView } from './RichImageNodeView'

export function RichBodyImageNodeView(props: ReactNodeViewProps) {
  // 감싸개(인라인 블록)도 칸 폭을 넘지 않게 해 넓은 이미지가 칸 폭까지만 늘게 한다.
  return <UploadImageNodeView {...props} imgClassName={ISSUE_BODY_IMAGE_CLASS} wrapperClassName="max-w-full" />
}
