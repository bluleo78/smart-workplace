// 노트 인라인 코드 마크 — 링크와 함께 쓸 수 있게 한 Code(WP-300 리뷰).
//
// StarterKit 의 Code 는 excludes '_'(모든 마크 배제)라 [`code`](url) 를 파싱하면 code 가 link 를 밀어내
// 링크가 사라졌다. link 만 허용하고 나머지(굵게·기울임·취소선)는 기존처럼 배제한다 — 링크 없는 기존 문서의
// 파싱·직렬화 결과(예: **`c`** → `c`)가 바뀌지 않게. 새 마크를 스키마에 들이면 여기 배제 목록도 함께 검토한다.
import Code from '@tiptap/extension-code'

export const WikiCode = Code.extend({
  excludes: 'bold italic strike code',
})
