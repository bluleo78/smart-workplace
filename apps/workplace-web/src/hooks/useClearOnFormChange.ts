// react-hook-form 폼의 값이 바뀌면 서버 오류 문구를 지우는 훅(WP-1558).
import { useEffect, useRef } from 'react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'

/**
 * 폼의 어떤 칸이든 값이 바뀌면 clear() 를 부른다.
 * 왜: 서버 오류는 「그때 보낸 값」에 대한 답이라 값이 바뀌면 더는 맞지 않는다. 제출 함수 안에서만 지우면
 * handleSubmit 이 클라이언트 검증 실패로 제출 함수를 부르지 않을 때 옛 서버 오류(「이미 존재하는 역할 이름입니다」 등)가
 * 지금 입력과 모순된 채 남는다.
 * form.reset()(창 열기·성공 뒤)도 이 콜백을 부르지만 그때도 서버 오류를 지우는 것이 맞다.
 * clear 는 최신 것을 ref 로 들고 있어 매 렌더 새 함수를 넘겨도 다시 구독하지 않는다. 언마운트 때 구독을 해제한다.
 */
export function useClearOnFormChange<T extends FieldValues>(form: Pick<UseFormReturn<T>, 'watch'>, clear: () => void) {
  const clearRef = useRef(clear)
  useEffect(() => {
    clearRef.current = clear
  })
  const { watch } = form
  useEffect(() => {
    const sub = watch(() => clearRef.current())
    return () => sub.unsubscribe()
  }, [watch])
}
