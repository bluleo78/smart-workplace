package com.workplace.auth.service;

import com.workplace.auth.exception.HomeAssistantNotConfiguredException;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.repository.AssistantConfigRepository.ConfigRow;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.repository.WorkspaceAssistantRepository;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 홈을 담당할 비서를 caller 기준으로 해석한다. 개인 비서(토큰 있으면) → 공용 비서(토큰 있으면) → 미설정 예외. 해석된 AGENT 의 assistant_config
 * 를 디폴트와 병합해 AssistantSpec 으로 만든다.
 */
@Service
@RequiredArgsConstructor
public class AssistantResolver {

  private final PersonalAssistantRepository personalRepo;
  private final WorkspaceAssistantRepository workspaceRepo;
  private final AssistantConfigRepository configRepo;
  private final AiAgentCredentialRepository credentialRepo;

  @Transactional(readOnly = true)
  public AssistantSpec resolve(long callerId) {
    long agentId =
        pickWithActiveToken(personalRepo.findAgentId(callerId))
            .or(() -> pickWithActiveToken(workspaceRepo.findAgentId()))
            .orElseThrow(
                () -> new HomeAssistantNotConfiguredException("홈 비서가 아직 설정되지 않았어요. 관리자에게 문의해주세요."));
    return buildSpec(agentId);
  }

  /** 후보 AGENT 에 active OAuth 토큰이 있을 때만 통과. */
  private Optional<Long> pickWithActiveToken(Optional<Long> candidate) {
    return candidate.filter(id -> credentialRepo.findActive(id).isPresent());
  }

  /** config 를 디폴트와 병합. */
  private AssistantSpec buildSpec(long agentId) {
    ConfigRow c = configRepo.find(agentId).orElse(new ConfigRow(null, null, null, null));
    return new AssistantSpec(
        agentId,
        c.model() != null ? c.model() : AssistantDefaults.MODEL,
        c.thinkingDepth() != null ? c.thinkingDepth() : AssistantDefaults.THINKING_DEPTH,
        c.maxTurns() != null ? c.maxTurns() : AssistantDefaults.MAX_TURNS,
        c.timeoutMs() != null ? c.timeoutMs() : AssistantDefaults.TIMEOUT_MS);
  }
}
