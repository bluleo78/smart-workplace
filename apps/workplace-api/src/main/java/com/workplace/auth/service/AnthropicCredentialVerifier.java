package com.workplace.auth.service;

import com.workplace.auth.exception.InvalidProviderCredentialException;
import com.workplace.auth.outbound.AiAgentModelsClient;
import com.workplace.auth.outbound.AiAgentModelsClient.CredentialCheck;
import com.workplace.global.outbound.AiAgentProperties;
import java.util.Map;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * Claude(anthropic) 토큰 등록 확인(WP-1496) — 키와 워크스페이스 ID 가 맞는지 ai-agent 모델 조회 한 번으로 본다. 틀린 값을 저장하면 실행할
 * 때마다 400 이 나는데 등록 화면은 성공으로 보이므로, 등록하는 순간 알린다. 키 종류(oat·api·usr)와 상관없이 모든 Claude 토큰을 확인한다.
 *
 * <ul>
 *   <li>{@code workspace_required}(워크스페이스를 정하지 않고 만든 키인데 ID 가 없음) → 400 + errors.workspaceId — 화면이
 *       ID 칸 옆에 안내하고 그 칸으로 초점을 옮긴다.
 *   <li>{@code workspace_invalid}(키에 맞지 않는 워크스페이스 ID — Anthropic 400 「anthropic-workspace-id header
 *       must be a valid workspace ID.」) → 400 + errors.workspaceId. 틀린 ID 를 저장하지 않고 그 칸에서 알린다.
 *   <li>{@code credential_rejected}(Anthropic 인증 실패 401) → 400. 목록 권한만 없는 토큰(403·다른 400)은 실행은 될 수
 *       있어 ai-agent 가 502 로 답하고, 아래처럼 통과한다.
 *   <li>ai-agent 가 꺼져 있거나 닿지 않거나 그 밖의 실패면 경고 로그만 남기고 통과한다 — 일시 장애로 등록을 막지 않는다.
 * </ul>
 *
 * 토큰은 로그·예외 메시지에 싣지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AnthropicCredentialVerifier {

  /** workspace_required 안내 — 응답 message 와 errors.workspaceId 에 같이 싣는다. */
  static final String WORKSPACE_REQUIRED_MESSAGE =
      "이 키는 Anthropic 워크스페이스 ID 가 필요합니다 — Anthropic 콘솔 Workspaces 에서 확인해 넣어 주세요";

  /** workspace_invalid 안내 — 응답 message 와 errors.workspaceId 에 같이 싣는다. */
  static final String WORKSPACE_INVALID_MESSAGE =
      "이 워크스페이스 ID 를 Anthropic 이 받지 않았어요 — 키가 속한 워크스페이스의 ID 인지 Anthropic 콘솔 Workspaces 에서"
          + " 확인해 주세요";

  /** credential_rejected 안내. */
  static final String REJECTED_MESSAGE =
      "Anthropic 이 키나 워크스페이스 ID 를 받아들이지 않았어요 — 토큰과 그 키가 속한 워크스페이스의 ID 인지 확인해 주세요";

  private final AiAgentModelsClient modelsClient;
  private final AiAgentProperties aiAgentProperties;

  /**
   * anthropic 토큰이면 ai-agent 로 확인하고, 필요·거절이면 예외를 던진다. 다른 provider 는 확인하지 않는다.
   *
   * @param provider 계정 종류(anthropic 일 때만 확인 — null 은 anthropic 으로 본다)
   * @param token 등록하려는 Anthropic 토큰(평문)
   * @param workspaceId {@link AnthropicKeys#normalizeWorkspaceId} 로 정리한 워크스페이스 ID(없으면 null)
   * @throws InvalidProviderCredentialException 워크스페이스 ID 필요·받지 않는 ID(errors.workspaceId) 또는 거절(400)
   */
  public void verify(String provider, String token, String workspaceId) {
    if (!AgentProviders.ANTHROPIC.equals(AgentProviders.normalize(provider))) return;
    if (!aiAgentProperties.enabled()) {
      log.info("ai-agent 연동이 꺼져 있어 Claude 토큰 등록 확인을 건너뜁니다");
      return;
    }
    // 확인 결과 하나에 처리 하나 — 통과·ID 필요·받지 않는 ID·거절·모름. 답이 없으면(null) 모름으로 본다(막지 않는다).
    CredentialCheck result =
        Objects.requireNonNullElse(
            modelsClient.checkAnthropicCredential(token, workspaceId), CredentialCheck.UNAVAILABLE);
    switch (result) {
      case ACCEPTED -> {
        // 통과 — 그대로 저장한다.
      }
      case WORKSPACE_REQUIRED ->
          throw new InvalidProviderCredentialException(
              WORKSPACE_REQUIRED_MESSAGE, Map.of("workspaceId", WORKSPACE_REQUIRED_MESSAGE));
      case WORKSPACE_INVALID ->
          throw new InvalidProviderCredentialException(
              WORKSPACE_INVALID_MESSAGE, Map.of("workspaceId", WORKSPACE_INVALID_MESSAGE));
      case REJECTED -> throw new InvalidProviderCredentialException(REJECTED_MESSAGE);
      case UNAVAILABLE ->
          // 모름(장애·연결 실패·응답 지연) — 저장은 하되 흔적을 남긴다. 실행 때 문제가 나면 이 로그로 확인한다.
          log.warn("Claude 토큰 등록 확인을 하지 못해 확인 없이 저장합니다(ai-agent 응답 없음·실패)");
    }
  }
}
