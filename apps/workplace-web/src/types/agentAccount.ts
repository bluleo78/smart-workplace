// 관리자 계정 묶음 응답(서버 AgentAccountResponse) 중 화면이 쓰는 부분 — 평문/암호문 없음(WP-1448).
// “이 AI 가 어느 계정을 쓰는지”를 식별해 모델 목록 같은 계정 기준 조회의 캐시 키로도 쓴다(WP-1458).
import type { CredentialProvider } from './providerCredential';

export interface AgentAccount {
  id: number;
  provider: CredentialProvider;
  label: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}
