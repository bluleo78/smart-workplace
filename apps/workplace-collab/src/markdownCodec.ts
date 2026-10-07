import { COLLAB_FRAGMENT, docToMarkdown, getMarkdownSchema, markdownToDoc } from '@smart-workplace/wiki-editor-schema'
import { prosemirrorToYXmlFragment, updateYFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror'
import * as Y from 'yjs'

// TipTap Collaboration 필드명 — 웹 에디터와 같은 공용 규약 값.
export const FRAGMENT = COLLAB_FRAGMENT

/** 마크다운 → Yjs 업데이트(최초 이관·reconcile 용). 새 Y.Doc(새 clientID)에서 만들어진다. */
export function markdownToYUpdate(md: string): Uint8Array {
  const doc = new Y.Doc()
  prosemirrorToYXmlFragment(markdownToDoc(md), doc.getXmlFragment(FRAGMENT))
  return Y.encodeStateAsUpdate(doc)
}

/** Yjs 문서 → 마크다운(API 에 저장하는 파생 body). */
export function yDocToMarkdown(doc: Y.Doc): string {
  return docToMarkdown(yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(FRAGMENT), getMarkdownSchema()))
}

/** Yjs 업데이트(저장된 상태) → 마크다운 — 새 Y.Doc 에 적용해 파생 body 를 만든다(드라이런·테스트 모드 저장본 읽기). */
export function yUpdateToMarkdown(update: Uint8Array): string {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, update)
  return yDocToMarkdown(doc)
}

/**
 * 문서를 주어진 마크다운과 같아지도록 최소 변경 적용 — 바뀐 블록만 교체되어 다른 블록의 동시 편집·커서가 유지된다
 * (WP-283 확인). origin 은 Yjs 트랜잭션 출처(편집자 기록·스냅샷 판단에 쓴다).
 */
export function replaceWithMarkdown(doc: Y.Doc, md: string, origin: unknown): void {
  const frag = doc.getXmlFragment(FRAGMENT)
  doc.transact(() => {
    // 4번째 인자는 y-prosemirror 의 바인딩 메타(노드↔Y 타입 매핑). 바인딩 없이 쓰므로 빈 맵.
    updateYFragment(doc, frag, markdownToDoc(md), { mapping: new Map(), isOMark: new Map() })
  }, origin)
}
