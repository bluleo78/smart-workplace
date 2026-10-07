// 위키 에디터용 인라인 atom 멘션 노드 `wikiMention` — 스키마·마크다운 파서 규칙은 공용 패키지에 있다(WP-284·WP-294).
// 웹은 라벨을 화면에서 그리는 NodeView 만 얹는다. NodeView 는 WikiMentionLabelsProvider 아래에서 렌더돼야 라벨이 채워진다.

import { WikiMention as WikiMentionSchema } from '@smart-workplace/wiki-editor-schema'
import { ReactNodeViewRenderer } from '@tiptap/react'

import { WikiMentionChipView } from './WikiMentionChipView'

export const WikiMention = WikiMentionSchema.extend({
  addNodeView() {
    return ReactNodeViewRenderer(WikiMentionChipView, { as: 'span' })
  },
})
