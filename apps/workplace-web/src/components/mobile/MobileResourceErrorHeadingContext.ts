import { createContext, useContext, useEffect } from 'react'

/** 모바일 모듈 안의 오류 제목 등록 — 오류가 화면 제목을 맡는 동안 모듈명은 일반 텍스트로 남긴다. */
export const MobileResourceErrorHeadingContext = createContext<{
  hasErrorHeading: boolean
  register: () => () => void
} | null>(null)

/** h1 오류가 사라지면 등록을 해제해 정상 화면의 모듈 제목 의미를 복원한다. */
export function useRegisterMobileResourceErrorHeading(enabled: boolean) {
  const register = useContext(MobileResourceErrorHeadingContext)?.register
  useEffect(() => {
    if (enabled && register) return register()
  }, [enabled, register])
}

/** 오류 본문에 h1이 있으면 모듈 헤더의 글꼴·탐색은 유지하고 태그만 바꾼다. */
export function useHasMobileResourceErrorHeading() {
  return useContext(MobileResourceErrorHeadingContext)?.hasErrorHeading ?? false
}
