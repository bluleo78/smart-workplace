package com.workplace.auth.service;

import com.workplace.auth.dto.AiAgentCredentialRow;
import com.workplace.auth.dto.UpdateAssistantSettingsRequest;
import com.workplace.auth.dto.WorkspaceAssistantResponse;
import com.workplace.auth.exception.KeyTargetMustBeAgentException;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.repository.AssistantConfigRepository.ConfigRow;
import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.exception.UserNotFoundException;
import com.workplace.user.repository.UserRepository;
import com.workplace.user.service.AgentRuntimePolicy;
import com.workplace.user.service.WorkspaceMemberGuard;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 공용 비서(workspace assistant) admin 서비스. admin 이 어느 AGENT 를 워크스페이스 기본 홈 비서로 지정하고, 그 비서의 모델/사고 깊이를
 * 설정한다. AGENT 유저만 지정 가능하며 HUMAN 은 거부한다.
 */
@Service
@RequiredArgsConstructor
@Transactional
public class WorkspaceAssistantService {

  private final WorkspaceAssistantRepository workspaceRepo;
  private final AssistantConfigRepository configRepo;
  private final AiAgentCredentialRepository credentialRepo;
  private final UserRepository userRepository;
  private final AssistantSettingsWriter settingsWriter;
  private final SuggestionModelPolicy suggestionModelPolicy;
  private final AgentRuntimePolicy agentRuntimePolicy;
  private final AiAgentCredentialService credentialService;
  private final WorkspaceMemberGuard memberGuard;

  /** 공용 비서로 지정. 대상이 없으면 404, AGENT 가 아니면 400(HUMAN 거부). */
  public void setAgent(long adminId, long agentUserId) {
    // WP-371: 실행 방식 변경(UserService.setAgentRuntime)과 같은 에이전트 행 락으로 직렬화 — 아래 EXTERNAL 검사와 upsert 사이에
    // runtime 이 EXTERNAL 로 바뀌는 경합을 막는다. 대상이 없으면 0행이 잠기고 아래에서 404 로 처리된다.
    agentRuntimePolicy.lock(agentUserId);
    // WP-703: 다른 워크스페이스의 AI 는 공용 비서로 지정할 수 없다(404) — 지정되면 그 AI 의 AI 연결로 이 워크스페이스 대화가 돈다.
    memberGuard.require(agentUserId);
    UserResponse user =
        userRepository
            .findById(agentUserId)
            .orElseThrow(() -> UserNotFoundException.ofId(agentUserId));
    // HUMAN 은 공용 비서가 될 수 없다 — AGENT 검증 재사용(400).
    if (!UserKind.isAgent(user.kind())) {
      throw new KeyTargetMustBeAgentException();
    }
    // WP-371: 외부 실행(EXTERNAL) 에이전트는 서버가 AI Chat 을 실행하지 않으므로 공용 비서로 지정할 수 없다(409).
    agentRuntimePolicy.requireMayBeAssistant(agentUserId);
    workspaceRepo.upsert(agentUserId, adminId);
  }

  /** 공용 비서 부분 설정 변경(WP-139) — 요청에 있는 필드만. 미지정 상태면 예외. */
  public void updateSettings(long adminId, UpdateAssistantSettingsRequest req) {
    long agentId =
        workspaceRepo
            .findAgentId()
            .orElseThrow(() -> new IllegalStateException("공용 비서가 설정되지 않았어요."));
    settingsWriter.apply(agentId, req);
  }

  /** 공용 비서 지정 해제 — 행 삭제(미지정 상태). */
  @Transactional
  public void clear() {
    workspaceRepo.deleteAssistant();
  }

  /** 공용 비서 상태 조회. 미지정이면 agentUserId=null. 모델/사고 깊이는 시스템 디폴트로 머지한다. */
  @Transactional(readOnly = true)
  public WorkspaceAssistantResponse get() {
    var agentIdOpt = workspaceRepo.findAgentId();
    if (agentIdOpt.isEmpty()) {
      return new WorkspaceAssistantResponse(null, null, false, null, null, null, null, null);
    }
    long agentId = agentIdOpt.get();
    String name = userRepository.findById(agentId).map(UserResponse::name).orElse(null);
    // WP-139: 활성 자격증명의 제공자로 자동 추천 모델을 정한다(토큰 없음이면 null).
    var credential = credentialRepo.findActive(agentId);
    boolean hasActiveToken = credential.isPresent();

    // ConfigRow 의 각 필드는 개별 nullable — 필드 단위로 디폴트와 머지한다.
    ConfigRow cur = configRepo.find(agentId).orElse(new ConfigRow(null, null, null, null));
    String model = cur.model() != null ? cur.model() : AssistantDefaults.MODEL;
    String thinkingDepth =
        cur.thinkingDepth() != null ? cur.thinkingDepth() : AssistantDefaults.THINKING_DEPTH;

    String suggestionModelAuto =
        suggestionModelPolicy.autoModel(
            hasActiveToken, credential.map(AiAgentCredentialRow::provider).orElse(null), model);
    return new WorkspaceAssistantResponse(
        agentId,
        name,
        hasActiveToken,
        model,
        thinkingDepth,
        cur.suggestionModel(),
        suggestionModelAuto,
        credentialService.findModelVision(agentId, model));
  }
}
