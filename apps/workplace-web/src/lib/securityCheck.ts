// WP-1262: HTML 보안 점검 칩 — 서버 상태·AI 가용성·폴링 상태를 화면 칩 한 가지로 줄이는 순수 판정과 문구.
import type { SecurityCheckView, SecurityRisk } from '../types/securityCheck'

/** 위험도 표시 문구. */
export const RISK_LABEL: Record<SecurityRisk, string> = { LOW: '낮음', CAUTION: '주의', HIGH: '높음' }

/** 근거 종류 표시 문구(모르는 종류는 「기타」). */
export const EVIDENCE_KIND_LABEL: Record<string, string> = {
  EXTERNAL_REQUEST: '바깥 요청',
  CREDENTIAL_INPUT: '로그인 흉내 입력창',
  OBFUSCATION: '난독화',
  NAVIGATION: '이동·팝업·다운로드',
  OTHER: '기타',
}

/** 위험도별 칩 색 — 시맨틱 토큰만(낮음 success·주의 warning·높음 destructive). */
export const RISK_CHIP_CLASS = {
  LOW: 'bg-success-subtle text-success-text',
  CAUTION: 'bg-warning-subtle text-warning-text',
  HIGH: 'bg-destructive/10 text-destructive',
} as const

export type SecurityChip =
  | { kind: 'hidden' }
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'result'; risk: SecurityRisk; label: string; evidenceCount: number }
  | { kind: 'failed'; canRetry: boolean }

/**
 * 칩 판정. 우선순위: AI 없음(→ 실패·재시도 불가) → 요청 중/진행 중(폴링 상한을 넘기면 실패·재시도 가능) → 결과·실패·건너뜀(→ 점검 단추).
 * view 가 아직 없으면(조회 중) 숨긴다.
 */
export function securityChip(
  view: SecurityCheckView | undefined,
  opts: { pollingExhausted: boolean; requesting: boolean; aiAvailable: boolean; errored?: boolean },
): SecurityChip {
  if (!opts.aiAvailable || view?.reason === 'NO_AI') return { kind: 'failed', canRetry: false }
  if (opts.requesting) return { kind: 'checking' }
  // 조회·요청이 오류로 끝났으면 칩이 사라지지 않게 실패 + 다시 점검으로 보인다.
  if (opts.errored) return { kind: 'failed', canRetry: true }
  if (!view) return { kind: 'hidden' }
  switch (view.status) {
    case null:
      return { kind: 'idle' }
    case 'PENDING':
    case 'CHECKING':
      return opts.pollingExhausted ? { kind: 'failed', canRetry: true } : { kind: 'checking' }
    case 'DONE': {
      if (!view.risk) return { kind: 'failed', canRetry: true }
      const evidenceCount = view.evidence.length
      return { kind: 'result', risk: view.risk, label: RISK_LABEL[view.risk], evidenceCount }
    }
    case 'FAILED':
      return { kind: 'failed', canRetry: true }
    // 건너뜀도 점검 단추를 보인다 — 칩은 웹이 스크립트를 봤을 때만 뜨므로, 서버 판정(인코딩 차이 등)이 어긋나도 사용자가 점검을 요청할 수 있게.
    case 'SKIPPED':
      return { kind: 'idle' }
    default:
      return { kind: 'hidden' }
  }
}

/** 칩에 보이는 글자 — 결과는 「주의 · 근거 3」(근거 0 건이면 위험도만). */
export function chipText(chip: SecurityChip): string {
  switch (chip.kind) {
    case 'idle':
      return 'AI 보안 점검'
    case 'checking':
      return 'AI 가 점검하는 중…'
    case 'failed':
      return '보안 점검을 하지 못했어요'
    case 'result':
      return chip.evidenceCount > 0 ? `${chip.label} · 근거 ${chip.evidenceCount}` : chip.label
    default:
      return ''
  }
}
