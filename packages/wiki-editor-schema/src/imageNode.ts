import Image from '@tiptap/extension-image'

/**
 * 노트 이미지 스키마(NodeView 없음) — 웹은 이걸 extend 해 NodeView 만 얹는다.
 * 노드 이름 'image' 유지(tiptap-markdown 내장 직렬화기 사용), inline:true(블록이면 문단 병합).
 * alt 는 null·'' 를 '' 하나로 정규화한다 — 웹 명령으로 만든 노드(null)와 마크다운 파싱 노드('')가
 * 달라 AI 적용(updateYFragment)마다 이미지 노드가 다시 쓰이던 문제(WP-283)를 막는다.
 *
 * 그 밖의 제약(#750):
 * - 새 이름(wikiImage 등)을 쓰면 tiptap-markdown 이 직렬화기를 못 찾아 저장 시 이미지가 통째로 사라진다.
 * - allowBase64 는 기본값(false) 유지 — base64 를 본문에 심으면 wiki_page.body 가 비대해진다.
 *   단, parseHTML 셀렉터가 `img[src]:not([src^="data:"])` 라 data: URI 는 image 노드로
 *   파싱되지 않는다 — base64 인라인 이미지가 든 페이지를 열었다 저장하면 조용히 사라진다.
 *   확정된 제약의 알려진 대가로 감수한다.
 */
export const WikiImageSchema = Image.configure({ inline: true }).extend({
  addAttributes() {
    const parent = this.parent?.() ?? {}
    return {
      ...parent,
      alt: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('alt') ?? '' },
    }
  },
})
