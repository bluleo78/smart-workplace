package com.workplace.auth.service;

import com.workplace.auth.dto.ActiveCredentialRef;
import com.workplace.auth.service.AiAgentCredentialService.ActiveProviderSecret;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 작업 공간(Pod) AI 가 묶인 AI 계정을 읽는 창구(WP-1448) — 계정 목록은 agentaccount 모듈이 가지므로 auth·agentruntime 은 이
 * 인터페이스만 보고, 구현은 agentaccount 가 둔다({@link AgentAccountFitPolicy} 와 같은 꼴 — auth 가 agentaccount 를
 * import 하지 않게).
 *
 * <p>runner 계약: 묶인 계정이 있으면 그 계정이 AI 의 활성 연결보다 먼저다. 버전은 계정 id 가 아니라 계정의 {@code secret_version} 이다 —
 * 원문을 교체하면 바뀌고, 다른 계정으로 옮겨도 한 시퀀스에서 나와 겹치지 않는다. 같은 계정을 쓰는 AI 들은 같은 버전을 받는다.
 */
public interface PodAccountSource {

  /**
   * 여러 AI 가 묶인 계정의 참조를 한 번에 — AI id → {@code ActiveCredentialRef(id = 계정 secret_version, provider =
   * 계정 종류)}. 묶이지 않았거나 계정이 폐기된 AI 는 빠진다.
   */
  Map<Long, ActiveCredentialRef> findBoundRefs(Collection<Long> agentUserIds);

  /**
   * AI 가 묶인 계정의 원문 — {@code ActiveProviderSecret(secret_version, 종류, 복호화 원문)}. 묶이지 않았거나 계정이 폐기됐으면
   * empty. 원문은 runner 응답으로만 나가고 로그·예외에 싣지 않는다.
   */
  Optional<ActiveProviderSecret> findBoundSecret(long agentUserId);

  /**
   * 묶인 계정의 runner login 버전을 한 번에(runner desired) — AI id → login version. genia·chatgpt 는 참조의 id(계정
   * secret_version) 그대로, OpenCode 는 계정 원문 + 그 AI 의 지정 모델로 {@link OpencodeLoginInfo} 의 같은 함수로
   * 계산한다({@code /secrets/login} 의 version 과 같은 값 — 다르면 runner 가 매 회차 다시 받는다).
   *
   * <p>구현은 복호화·계산을 이 메서드 본문 안에서 하고, AI 하나의 원문을 읽지 못하면(복호화·JSON 실패) 본문 안에서 잡아 그 AI 만 뺀다 — 예외가 트랜잭션
   * 프록시 경계를 넘으면 호출자의 트랜잭션이 rollback-only 로 표시돼 위치 전체 desired 가 500 이 되기 때문이다. 이 메서드는 그런 AI 하나의 실패로
   * 예외를 던지지 않는다.
   *
   * @param refs Pod 로 로그인 정보를 넘길 AI 의 묶인 계정 참조({@link #findBoundRefs} 결과 중 템플릿에 맞는 것)
   */
  Map<Long, Long> findBoundPodLoginVersions(Map<Long, ActiveCredentialRef> refs);

  /** AI 가 묶인 계정의 종류 — 묶이지 않았거나 계정이 폐기됐으면 empty. 원문을 복호화하지 않는다(실행 방식 전환의 「맞는 계정」 판정용). */
  default Optional<String> findBoundProvider(long agentUserId) {
    return Optional.ofNullable(findBoundRefs(List.of(agentUserId)).get(agentUserId))
        .map(ActiveCredentialRef::provider);
  }

  /**
   * 기존 연결 등록 다리(WP-1448, 계정 화면 WP-1451 전까지) — 관리 경로로 작업 공간(Pod) AI 에 연결을 등록하면 같은 원문으로 계정을 만들어(같은
   * 지문의 살아 있는 계정이 있으면 그것을 다시 쓴다) 그 AI 를 묶는다. 실행 설정 행이 없거나(Pod 아님) 개인 비서면 아무것도 하지 않는다. 호출자의 쓰기 트랜잭션
   * 안에서, 연결 행을 쓴 뒤에 부른다 — 묶기가 거절되면(템플릿 사라짐 등) 등록 전체가 롤백된다.
   *
   * @param normalizedPlaintext 연결 등록과 같은 규칙으로 정규화한 원문(로그인형은 {@code LoginInfoNormalizer} 결과)
   * @param label 요청 라벨 — 비었으면 「<AI 이름> 계정」
   */
  void bindFromLegacy(
      Long callerId, long agentUserId, String provider, String normalizedPlaintext, String label);

  /**
   * AI 의 묶음을 푼다 — 묶이지 않았으면 아무것도 하지 않는다. 실제로 풀었으면 runner 에 알린다(묶기 서비스와 같은 경로).
   *
   * <p>구현이 구성원 가드({@code WorkspaceMemberGuard.requireAgent})를 지나므로 이 워크스페이스의 활성 구성원 AI 를 다루는 호출자만
   * 부른다.
   *
   * @return 묶여 있다가 풀렸는지 — 실행 방식 전환이 남은 옛 연결까지 끊을지 판단한다
   */
  boolean unbindIfBound(Long callerId, long agentUserId);
}
