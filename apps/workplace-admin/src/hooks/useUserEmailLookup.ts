import { useMutation } from '@tanstack/react-query'
import axios from 'axios'
import { useRef, useState } from 'react'
import { z } from 'zod'

import { platformUsers } from '../api/platformUsers'
import type { PlatformUserLookup } from '../types/platform'

const emailSchema = z.email('올바른 이메일 형식이 아닙니다')

/** 조회 결과 — 어느 이메일에 대한 결과인지 함께 둔다. */
type LookupResult = { email: string } & (
  | { status: 'found'; user: PlatformUserLookup }
  | { status: 'not-found' }
  | { status: 'error' }
)

// 운영자 콘솔 — "이메일 입력 + 확인" 으로 전역 사용자를 정확히 일치 조회하는 상태 훅.
// 운영자는 개별 사용자를 식별할 수 없어야 하므로(신원 마스킹 정책) 부분 검색은 두지 않고, 운영자가 이미 아는 이메일을
// 정확히 입력했을 때만 그 사용자를 확인시켜 준다. 테넌트 생성의 소유자 지정(WP-337)과 멤버 추가가 같이 쓴다.
// 결과는 조회한 이메일과 함께 저장하고 "지금 입력과 같을 때만" 유효하게 본다 — 확인 후 이메일을 고치거나 늦게 도착한
// 응답이 있어도 엉뚱한 사용자가 지정되지 않는다.
export function useUserEmailLookup() {
  const [email, setEmail] = useState('')
  // 입력칸 자체의 안내(형식 오류, "확인하세요") — 이메일을 고치면 지운다.
  const [fieldError, setFieldError] = useState('')
  const [result, setResult] = useState<LookupResult | null>(null)
  // 조회 세대 — reset 때 올려서, 다이얼로그를 닫은 뒤 늦게 도착한 응답이 결과를 되살리지 못하게 한다.
  const generation = useRef(0)

  const mutation = useMutation({
    mutationFn: async ({ value }: { value: string; gen: number }): Promise<LookupResult> => {
      try {
        const user = await platformUsers.lookup(value)
        return { email: value, status: 'found', user }
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          return { email: value, status: 'not-found' }
        }
        throw err
      }
    },
    onSuccess: (res, { gen }) => {
      if (gen === generation.current) setResult(res)
    },
    onError: (_err, { value, gen }) => {
      if (gen === generation.current) setResult({ email: value, status: 'error' })
    },
  })

  const trimmed = email.trim()
  const current = result && result.email === trimmed ? result : null
  const status: 'idle' | 'found' | 'not-found' =
    current?.status === 'found' || current?.status === 'not-found' ? current.status : 'idle'
  const user = current?.status === 'found' ? current.user : null
  const error =
    fieldError || (current?.status === 'error' ? '사용자 확인에 실패했습니다.' : '')

  // 이메일을 고치면 이전 결과를 버린다 — 고쳤다가 되돌려도 다시 확인해야 한다(그사이 계정 상태가 바뀌었을 수 있음).
  const changeEmail = (value: string) => {
    setEmail(value)
    setFieldError('')
    if (result && result.email !== value.trim()) setResult(null)
  }

  // 앞뒤 공백을 걷은 값으로 형식을 검증한 뒤 조회한다. 형식이 틀리면 조회하지 않고 오류만 띄운다.
  const check = () => {
    const parsed = emailSchema.safeParse(trimmed)
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? '올바른 이메일 형식이 아닙니다')
      return
    }
    setFieldError('')
    mutation.mutate({ value: trimmed, gen: generation.current })
  }

  // 선택 입력(소유자 등)에서 제출 직전 호출 — 비었으면 지정 안 함(ok, user=null), 확인으로 찾았으면 그 사용자,
  // 쳤지만 확인하지 않았거나 못 찾았으면 막는다(ok=false). 확인 전이면 "확인하세요" 안내를 띄운다.
  const requireConfirmed = (): { ok: true; user: PlatformUserLookup | null } | { ok: false } => {
    if (!trimmed) return { ok: true, user: null }
    if (user) return { ok: true, user }
    // 확인 전일 때만 안내한다 — 찾지 못함·조회 실패는 이미 그 사유가 보이고 있으므로 덮어쓰지 않는다.
    if (!current) setFieldError('확인 버튼으로 이메일을 확인하세요.')
    return { ok: false }
  }

  const reset = () => {
    generation.current += 1
    setEmail('')
    setFieldError('')
    setResult(null)
    mutation.reset()
  }

  return {
    email,
    setEmail: changeEmail,
    /** 조회한 이메일(공백 제거) — 찾지 못했을 때 신규 계정 생성 폼에 넘긴다. */
    checkedEmail: current?.email ?? '',
    error,
    status,
    user,
    check,
    requireConfirmed,
    reset,
    isChecking: mutation.isPending,
  }
}
