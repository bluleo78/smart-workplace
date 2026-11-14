import { PluginKey } from '@tiptap/pm/state'
import type { DecorationSet } from '@tiptap/pm/view'

/**
 * 판 미리보기 차이 표시 데코레이션 상태 키(WP-298) — 미리보기 컴포넌트가 setMeta 로 새 DecorationSet 을 넣는다.
 * 따로 둔 까닭: 첨부 칩(wikiAttachmentChips, 편집기·공개 공유에도 들어간다)이 이 키만 읽는데, 차이 계산 모듈
 * (wikiRevisionPreviewDoc → diff-match-patch)까지 편집기·공개 화면 번들로 끌려오지 않게 한다.
 */
export const wikiRevisionDiffKey = new PluginKey<DecorationSet>('wikiRevisionDiff')
