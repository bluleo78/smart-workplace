// 상태 이름 입력 흐름 공용 훅(WP-937) — 설정 「+ 추가」 입력 줄(StatusAddForm)과 보드 이름 입력기(StatusNameEditor)가 같이 쓴다.
// 무엇을: 값·오류·저장 중 상태, 클라이언트 검증(빈 이름·30자·범주 코드·중복·상한), Enter(한글 조합·꼬리 Enter 가드)·Esc, 서버 오류 문구 매핑.
// 왜: 두 곳이 따로 구현해 409 중복 문구 매핑은 편집기에만, IME 조합 Enter 가드는 추가 폼에만 있었다. 겉모습은 각 컴포넌트가 그대로 그린다.
import type { ChangeEvent, KeyboardEvent } from 'react'
import { useRef, useState } from 'react'

import { useSingleLineEnter } from '@/hooks/useSingleLineEnter'
import { extractApiError, isConflictError } from '@/lib/api-error'
import { STATUS_NAME_DUPLICATED, statusAddBlockedReason, validateStatusName } from '@/lib/projectStatuses'
import type { ProjectStatus } from '@/types/projectStatus'

/**
 * 저장 실패를 입력 아래 문구로 바꾼다. 서버의 중복 409(「이미 존재하는 상태 이름입니다: 이름」)는 클라이언트 중복 문구와 같게 —
 * 이름은 바로 위 입력에 있으니 「: 이름」을 되풀이하지 않는다. 같은 409 인 상한 초과(「상태는 프로젝트당 20개까지…」)는
 * 중복이 아니므로 서버 문구 그대로 둔다(둘 다 409 라 상태 코드만으로는 못 가른다).
 */
export function statusNameSaveError(err: unknown, fallback: string): string {
  const message = extractApiError(err, fallback)
  return isConflictError(err) && message.startsWith(STATUS_NAME_DUPLICATED) ? STATUS_NAME_DUPLICATED : message
}

/**
 * 저장 전 클라이언트 판정 — 막을 문구, 보내도 되면 null. 바뀌지 않은 이름(요청 없이 닫기)은 submit 이 이것보다 먼저 가른다.
 * 새 상태(excludeId 없음)는 상한(20)에 닿았으면 진입점과 같은 문구로 막는다
 * — 진입점이 미리 비활성이지만, 열어 둔 사이 목록이 늘어난 경우 409 를 만나기 전에 알린다.
 */
export function checkStatusName(
  value: string,
  { statuses, excludeId }: { statuses: readonly ProjectStatus[]; excludeId?: number },
): string | null {
  return validateStatusName(value, statuses, excludeId) ?? (excludeId == null ? (statusAddBlockedReason(statuses) ?? null) : null)
}

export function useStatusNameForm({
  initial = '',
  statuses,
  excludeId,
  onSubmit,
  onCancel,
  failMessage,
}: {
  initial?: string
  // 중복·상한 검사 대상 — 이 프로젝트의 상태 목록.
  statuses: readonly ProjectStatus[]
  // 이름을 바꾸는 상태 자신(중복 비교에서 뺀다). 없으면 새 상태 만들기 — 상한 검사를 한다.
  excludeId?: number
  // 앞뒤 공백을 뺀 이름으로 저장한다. 실패(reject)하면 문구를 입력 아래에 보이고 입력을 유지한다.
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
  // 서버 문구가 없을 때(네트워크 등)의 실패 문구.
  failMessage: string
}) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // 한글 조합 Enter·확정 직후 꼬리 Enter 는 저장으로 보지 않는다(WP-331).
  const enterKey = useSingleLineEnter()

  async function submit() {
    if (saving) return
    // 이름 변경(initial 있음)에서 바뀌지 않은 이름(앞뒤 공백 무시)은 요청 없이 닫는다.
    if (initial && value.trim() === initial.trim()) return onCancel()
    const checked = checkStatusName(value, { statuses, excludeId })
    if (checked) return setError(checked)
    setSaving(true)
    try {
      await onSubmit(value.trim())
    } catch (err) {
      setError(statusNameSaveError(err, failMessage))
      // 고칠 수 있게 입력으로 포커스를 되돌린다(저장 버튼을 눌렀으면 포커스가 버튼에 있다).
      inputRef.current?.focus()
    } finally {
      setSaving(false)
    }
  }

  return {
    value,
    error,
    saving,
    submit,
    /** 입력란에 그대로 건다 — 값 변경은 오류를 지운다. */
    inputProps: {
      ref: inputRef,
      value,
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        setValue(e.target.value)
        setError(null)
      },
      onCompositionEnd: enterKey.onCompositionEnd,
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          // 바깥(다이얼로그·팝오버)으로 Esc 가 번지지 않게 여기서 끝낸다.
          e.preventDefault()
          e.stopPropagation()
          onCancel()
          return
        }
        // 폼 기본 제출 대신 여기서 저장한다 — 조합·꼬리 Enter 를 거르려면 기본 동작(암묵 제출)을 막아야 한다.
        enterKey.handleEnter(e, () => void submit())
      },
    },
  }
}
