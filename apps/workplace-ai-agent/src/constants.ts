// 로컬 기본 포트 — workplace-api(9090), workplace-web(6173) 과 분리.
export const DEFAULT_PORT = 7070;

// 사내 서비스 간 인증 스킴 — Authorization: Internal {token}
export const INTERNAL_AUTH_SCHEME = 'Internal ';

// workplace-api 기본 URL — .env 에서 override.
export const DEFAULT_API_BASE_URL = 'http://localhost:9090/api/v1';
