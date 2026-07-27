import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer } from '@tiptap/react'

import { WikiImageNodeView } from './WikiImageNodeView'

/**
 * 노트 본문 이미지 확장 (#750).
 *
 * - 노드 이름은 반드시 'image' 를 유지한다. tiptap-markdown 은 노드 *이름*으로 직렬화기를
 *   찾으며 'image' 에 대한 내장 처리를 갖는다. 새 이름(wikiImage 등)을 쓰면 직렬화기가 없어
 *   저장 시 이미지가 통째로 사라진다 — 이 확장이 고치려는 바로 그 버그가 재발한다.
 *   그래서 새 Node 를 만들지 않고 Image 를 extend 해 노드뷰만 얹는다.
 * - inline:true 가 아니면 이미지가 블록 노드가 되어 앞뒤 문단이 합쳐진다(빈 줄 소실).
 * - allowBase64 는 기본값(false) 유지 — base64 를 본문에 심으면 wiki_page.body 가 비대해진다.
 *   단, parseHTML 셀렉터가 `img[src]:not([src^="data:"])` 라 data: URI 는 image 노드로
 *   파싱되지 않는다 — base64 인라인 이미지가 든 페이지를 열었다 저장하면 #750 과 동일하게
 *   조용히 사라진다. 확정된 제약의 알려진 대가로 감수한다.
 * - 노드뷰는 /api/v1 경로를 blob objectURL 로 바꿔 표시한다(메모리 Bearer 라 <img> 가
 *   Authorization 헤더를 못 싣는다).
 */
export const WikiImage = Image.configure({ inline: true }).extend({
  addNodeView() {
    return ReactNodeViewRenderer(WikiImageNodeView)
  },
})
