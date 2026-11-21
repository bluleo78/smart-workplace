// WP-1943: 결과 문구를 스크린리더에 알리는 화면 밖(sr-only) live region — IssueResultStatus 의 범용판.
import { useEffect, useState } from 'react'

/**
 * 결과 안내 영역. 화면에는 보이지 않는다.
 * - 첫 렌더의 conditionKey 는 읽지 않는다. 키가 한 번이라도 바뀐 뒤부터 안내한다.
 * - 키가 바뀌면 문구를 먼저 비우고, ready 이면서 text 가 있을 때 한 틱 뒤 채운다 — 같은 문구도 다시 낭독되게 한다.
 * - 같은 키에서 이미 알렸다면 text 가 달라져도 다시 채우지 않는다(조작 중 불쑥 읽히는 것 방지).
 */
export function ResultStatus({
  conditionKey,
  ready,
  text,
  testId,
}: {
  conditionKey: string
  ready: boolean
  text: string
  testId: string
}) {
  // 렌더 중 상태 보정 패턴 — 키가 처음 바뀐 순간부터 안내를 켠다(한 번 켜면 유지).
  // filled = 이번 키에서 이미 알린 문구. 키가 바뀌면 비우므로 키를 따로 저장하지 않는다.
  const [filled, setFilled] = useState<string | null>(null)
  const [prevKey, setPrevKey] = useState(conditionKey)
  const [changed, setChanged] = useState(false)
  if (prevKey !== conditionKey) {
    setPrevKey(conditionKey)
    setChanged(true)
    setFilled(null)
  }
  const shown = filled ?? ''
  const canFill = changed && ready && text !== '' && filled === null

  // 비워진 상태가 먼저 렌더되도록 한 틱 뒤에 채운다. 타이머는 정리한다.
  useEffect(() => {
    if (!canFill) return
    const timer = setTimeout(() => setFilled(text), 0)
    return () => clearTimeout(timer)
  }, [canFill, text])

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid={testId}>
      {shown}
    </div>
  )
}
