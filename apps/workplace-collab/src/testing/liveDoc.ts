import { getMarkdownSchema } from '@smart-workplace/wiki-editor-schema'
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror'
import * as Y from 'yjs'

import { FRAGMENT, markdownToYUpdate } from '../markdownCodec'

/**
 * 병합 적용 테스트용 실시간 문서 헬퍼 — 서버 없이 Y 문서를 만들고 사람 입력(Y 직접 조작)을 흉내 낸다.
 * markdownCodec.test(keepLive)와 mergeJob.test(워커 병합)가 함께 쓴다.
 */

/** md 로 문서를 만들고 edit 로 실시간 편집(Y 직접 조작)을 흉내 낸다. */
export function liveDoc(md: string, edit?: (frag: Y.XmlFragment) => void): Y.Doc {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, markdownToYUpdate(md))
  edit?.(doc.getXmlFragment(FRAGMENT))
  return doc
}

/**
 * path(최상위부터 자식 인덱스)의 글 블록에 text 를 친다 — 끝('end', 마지막 글 조각 끝) 또는 맨 앞(0). 강제 줄바꿈이 있는 문단도 끝에 친다.
 * attrs 는 친 글자의 서식(Y 텍스트 속성, 예: { bold: null } = 굵게 해제).
 */
export function typeIn(frag: Y.XmlFragment, path: number[], text: string, at: 'end' | 0 = 'end', attrs?: Record<string, unknown>): void {
  let el: Y.XmlFragment | Y.XmlElement = frag
  for (const i of path) el = el.get(i) as Y.XmlElement
  const t = (at === 'end' ? el.get(el.length - 1) : el.get(0)) as Y.XmlText
  t.insert(at === 'end' ? t.length : 0, text, attrs)
}

/** Y 문서 → ProseMirror 루트(적용 결과 확인용). */
export const rootOf = (doc: Y.Doc) => yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(FRAGMENT), getMarkdownSchema())
