// 복사 표지 직렬화기 — 편집기에서 복사한 클립보드 HTML 의 첫 최상위 요소에 표지 속성을 단다.
// 노트(NOTE_COPY_ATTR)와 메일 서명 편집기(SIGNATURE_COPY_ATTR)가 같이 쓴다 — 붙여넣을 때 「이 편집기에서 나온 것」을 가려
// 바깥 HTML 과 다르게 다루기 위해서다(WP-1726 리뷰: 두 곳에 같은 직렬화기가 복사돼 있던 것을 하나로).
import { DOMSerializer, type Schema } from '@tiptap/pm/model';

/**
 * 스키마 기본 직렬화 결과의 첫 최상위 요소에 `attr` 표지를 다는 직렬화기를 만든다.
 * 최상위가 글자뿐이면(드묾) 표지를 달 곳이 없어 바깥 붙여넣기로 다뤄진다 — 안전한 쪽.
 */
export function copyMarkerSerializer(schema: Schema, attr: string): DOMSerializer {
  const base = DOMSerializer.fromSchema(schema);
  return new (class extends DOMSerializer {
    serializeFragment(...args: Parameters<DOMSerializer['serializeFragment']>) {
      const frag = super.serializeFragment(...args);
      for (let child = frag.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1) {
          (child as HTMLElement).setAttribute(attr, '');
          break;
        }
      }
      return frag;
    }
  })(base.nodes, base.marks);
}
