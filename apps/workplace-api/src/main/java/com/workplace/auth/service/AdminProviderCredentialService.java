package com.workplace.auth.service;

import com.workplace.auth.dto.OAuthTokenMetaResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 관리 경로(AI 관리 화면)의 AI 연결 등록·회수(WP-1448) — 기존 연결 처리({@link AiAgentCredentialService})에 「AI 계정 목록」
 * 다리를 붙인다. 계정 화면(WP-1451)이 생기기 전까지 지금 화면만으로 작업 공간(Pod) AI 의 키를 바꿀 수 있게 하려는 것이다.
 *
 * <ul>
 *   <li>등록: 지금처럼 연결 행을 쓴다(모델 설정·보고 모델 목록이 연결 행 id 를 쓴다). 이어서 Pod AI 면 같은 원문으로 계정을 만들어(같은 키는 하나로)
 *       묶는다 — runner 는 묶인 계정을 먼저 보므로 방금 넣은 키가 Pod 로 간다.
 *   <li>회수: 연결 행을 끊고 묶음도 푼다.
 * </ul>
 *
 * <p>계정 쪽은 {@link PodAccountSource} 로만 부른다(auth 가 agentaccount 를 import 하지 않게). 개인 비서(내 설정 경로)와 서비스
 * 내부 호출은 {@link AiAgentCredentialService} 를 그대로 쓰므로 바뀌지 않는다. 한 트랜잭션이라 묶기가 거절되면 연결 등록도 롤백된다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class AdminProviderCredentialService {

  private final AiAgentCredentialService credentials;
  private final PodAccountSource podAccounts;

  /**
   * 연결을 등록하고(기존 활성 연결은 자동 회수), Pod AI 면 같은 원문의 계정에 묶는다. workspaceId(WP-1496)는 Anthropic 워크스페이스
   * ID(선택) — 계정에도 같이 넘긴다.
   */
  public OAuthTokenMetaResponse register(
      Long callerId,
      Long agentUserId,
      String provider,
      String plaintextSecret,
      String label,
      String model,
      String workspaceId) {
    // WP-1496: 워크스페이스 ID 검증·Claude 토큰 등록 확인은 연결 등록이 한다(필요·거절이면 여기서 400, 묶기 전).
    OAuthTokenMetaResponse meta =
        credentials.register(
            callerId, agentUserId, provider, plaintextSecret, label, model, workspaceId);
    // 연결 등록과 같은 정규화 — 로그인형은 그 프로그램이 읽는 키만 남긴 원문이 저장되므로 계정도 같은 원문을 받는다(등록이 이미 형식을 검증했다).
    String normalized =
        AgentProviders.isLogin(provider)
            ? LoginInfoNormalizer.normalize(provider, plaintextSecret)
            : plaintextSecret;
    podAccounts.bindFromLegacy(callerId, agentUserId, provider, normalized, label, workspaceId);
    return meta;
  }

  /** 연결을 회수하고(없으면 noop) 묶인 계정도 푼다 — 남은 묶음이 회수한 키 대신 계속 Pod 로 가지 않게. */
  public void revoke(Long callerId, Long agentUserId) {
    credentials.revoke(callerId, agentUserId);
    // WP-1515: 묶음이 없어도 미뤄 둔 generation 을 바로 적용으로 돌리는 회수 전용 창구를 쓴다.
    podAccounts.unbindFromLegacy(callerId, agentUserId);
  }
}
