// WP-1262: HTML 파일 AI 보안 점검 — 서버 HTTP 계약(SecurityCheckView)의 웹 쪽 타입.

/** 점검 진행 상태. null = 아직 점검 행이 없음(옛 파일·미요청). */
export type SecurityCheckStatus = 'PENDING' | 'CHECKING' | 'DONE' | 'FAILED' | 'SKIPPED'
/** 위험도. */
export type SecurityRisk = 'LOW' | 'CAUTION' | 'HIGH'
/** 근거 종류(서버 enum 문자열 그대로 — 모르는 값은 「기타」로 보인다). */
export type SecurityEvidenceKind = 'EXTERNAL_REQUEST' | 'CREDENTIAL_INPUT' | 'OBFUSCATION' | 'NAVIGATION' | 'OTHER'

/** 점검이 짚은 근거 한 건. */
export interface SecurityEvidence {
  kind: string
  detail: string
}

/** 점검 결과 조회·요청 응답. */
export interface SecurityCheckView {
  status: SecurityCheckStatus | null
  risk: SecurityRisk | null
  headline: string | null
  evidence: SecurityEvidence[]
  checkedAt: string | null
  /** 점검하지 않은 까닭 — NO_AI(AI 없음)·TOO_LARGE(원본 20MB 초과)·ERROR. */
  reason: 'NO_AI' | 'TOO_LARGE' | 'ERROR' | null
}
