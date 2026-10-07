import { WikiImageSchema } from '@smart-workplace/wiki-editor-schema'
import { ReactNodeViewRenderer } from '@tiptap/react'

import { WikiImageNodeView } from './WikiImageNodeView'

/**
 * 노트 본문 이미지 확장 (#750) — 공용 스키마(WikiImageSchema)에 웹 노드뷰만 얹는다.
 * 스키마 제약(노드 이름 'image'·inline·alt 정규화·base64 미허용)은 패키지 imageNode.ts 참조.
 * 노드뷰는 /api/v1 경로를 blob objectURL 로 바꿔 표시한다(메모리 Bearer 라 <img> 가
 * Authorization 헤더를 못 싣는다).
 */
export const WikiImage = WikiImageSchema.extend({
  addNodeView() {
    return ReactNodeViewRenderer(WikiImageNodeView)
  },
})
