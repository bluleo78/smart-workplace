package com.workplace.auth.service;

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

  /** 공용 비서로 지정. 대상이 없으면 404, AGENT 가 아니면 400(HUMAN 거부). */
  public void setAgent(long adminId, long agentUserId) {
    UserResponse user =
        userRepository
            .findById(agentUserId)
            .orElseThrow(() -> new UserNotFoundException("사용자를 찾을 수 없습니다: " + agentUserId));
    // HUMAN 은 공용 비서가 될 수 없다 — AGENT 검증 재사용(400).
    if (!UserKind.isAgent(user.kind())) {
      throw new KeyTargetMustBeAgentException();
    }
    workspaceRepo.upsert(agentUserId, adminId);
  }

  /** 공용 비서의 모델/사고 깊이 설정. maxTurns/timeoutMs 는 기존 값 보존. 미지정 상태면 409. */
  public void updateSettings(long adminId, String model, String thinkingDepth) {
    long agentId =
        workspaceRepo
            .findAgentId()
            .orElseThrow(() -> new IllegalStateException("공용 비서가 설정되지 않았어요."));
    // 기존 튜닝 값(maxTurns/timeoutMs)을 덮어쓰지 않도록 현재 행을 읽어 보존한다.
    ConfigRow cur = configRepo.find(agentId).orElse(new ConfigRow(null, null, null, null));
    configRepo.upsert(agentId, model, thinkingDepth, cur.maxTurns(), cur.timeoutMs());
  }

  /** 공용 비서 상태 조회. 미지정이면 agentUserId=null. 모델/사고 깊이는 시스템 디폴트로 머지한다. */
  @Transactional(readOnly = true)
  public WorkspaceAssistantResponse get() {
    var agentIdOpt = workspaceRepo.findAgentId();
    if (agentIdOpt.isEmpty()) {
      return new WorkspaceAssistantResponse(null, null, false, null, null);
    }
    long agentId = agentIdOpt.get();
    String name = userRepository.findById(agentId).map(UserResponse::name).orElse(null);
    boolean hasActiveToken = credentialRepo.findActive(agentId).isPresent();

    // ConfigRow 의 각 필드는 개별 nullable — 필드 단위로 디폴트와 머지한다.
    ConfigRow cur = configRepo.find(agentId).orElse(new ConfigRow(null, null, null, null));
    String model = cur.model() != null ? cur.model() : AssistantDefaults.MODEL;
    String thinkingDepth =
        cur.thinkingDepth() != null ? cur.thinkingDepth() : AssistantDefaults.THINKING_DEPTH;

    return new WorkspaceAssistantResponse(agentId, name, hasActiveToken, model, thinkingDepth);
  }
}
