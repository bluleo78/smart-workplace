// React 자식에서 글자만 뽑는 작은 도구 — 도움말 본문과 AI 답이 굵은 글자(화면 문구)를 화면 단추 이름과 견줄 때 함께 쓴다.
import { Children, isValidElement, type ReactNode } from 'react'

/**
 * React 자식의 글자만 이어 붙인다 — 굵은 글자 안 자리표시·인라인 코드 같은 요소 조각도 글자로 따라 내려간다.
 * 그려진 DOM(textContent)을 렌더 중에 읽을 수 없어, 같은 결과를 자식 트리에서 얻는다.
 */
export function nodeText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child)
      if (isValidElement<{ children?: ReactNode }>(child)) return nodeText(child.props.children)
      return ''
    })
    .join('')
}
