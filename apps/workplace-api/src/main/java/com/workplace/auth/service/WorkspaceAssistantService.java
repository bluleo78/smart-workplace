package com.workplace.auth.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.dto.AiAgentCredentialRow;
import com.workplace.auth.dto.UpdateAssistantSettingsRequest;
import com.workplace.auth.dto.WorkspaceAssistantResponse;
import com.workplace.auth.exception.KeyTargetMustBeAgentException;
import com.workplace.auth.exception.PersonalAssistantAdminChangeForbiddenException;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.repository.AssistantConfigRepository.ConfigRow;
import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.dto.AgentUsernames;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.exception.UserNotFoundException;
import com.workplace.user.repository.UserRepository;
import com.workplace.user.service.AgentRuntimePolicy;
import com.workplace.user.service.WorkspaceMemberGuard;
import java.util.LinkedHashMap;
import java.util.Map;
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
  private final AuditLogService auditLogService;

  /** 공용 비서로 지정. 대상이 없으면 404, AGENT 가 아니면 400(HUMAN 거부). */
  public void setAgent(long adminId, long agentUserId) {
    // WP-371: 실행 방식 변경(UserService.setAgentRuntime)과 같은 에이전트 행 락으로 직렬화 — 아래 EXTERNAL 검사와 upsert 사이에
    // runtime 이 EXTERNAL 로 바뀌는 경합을 막는다. 대상이 없으면 0행이 잠기고 아래에서 404 로 처리된다.
    agentRuntimePolicy.lock(agentUserId);
    // WP-703: 다른 워크스페이스의 AI 는 공용 비서로 지정할 수 없다(404) — 지정되면 그 AI 의 AI 연결로 이 워크스페이스 대화가 돈다.
    // WP-1075: 사용을 중지한(멤버십 정지) AI 도 에이전트 목록에 보이게 됐다 — 정지된 AI 로 공통 대화가 돌지 않게 지정을 막는다(409).
    String membershipStatus = memberGuard.require(agentUserId);
    UserResponse user =
        userRepository
            .findById(agentUserId)
            .orElseThrow(() -> UserNotFoundException.ofId(agentUserId));
    // HUMAN 은 공용 비서가 될 수 없다 — AGENT 검증 재사용(400).
    if (!UserKind.isAgent(user.kind())) {
      throw new KeyTargetMustBeAgentException();
    }
    // WP-1163: 개인 비서는 주인의 자격증명으로 주인만을 위해 움직인다 — 공통 비서가 되면 개인 비서가 없는 구성원 모두의 대화가 주인 모르게 그
    // 토큰으로 돈다(403).
    if (AgentUsernames.isPersonalAssistant(user.username())) {
      throw new PersonalAssistantAdminChangeForbiddenException("개인 비서는 공통 비서로 지정할 수 없습니다");
    }
    // 정지 안내(409)는 지정할 수 있는 AI 에게만 — 개인 비서에게 「활성 상태를 켜세요」라고 하면 켠 뒤에도 403 이라 헛걸음이 된다.
    if (MembershipRepository.STATUS_SUSPENDED.equals(membershipStatus)) {
      throw new IllegalStateException("사용이 중지된 에이전트는 공통 비서로 지정할 수 없습니다. 먼저 활성 상태를 켜세요.");
    }
    // WP-371: 외부 실행(EXTERNAL) 에이전트는 서버가 AI Chat 을 실행하지 않으므로 공용 비서로 지정할 수 없다(409).
    agentRuntimePolicy.requireMayBeAssistant(agentUserId);
    Long previousId = workspaceRepo.findAgentId().orElse(null);
    workspaceRepo.upsert(agentUserId, adminId);
    Map<String, Object> meta = new LinkedHashMap<>();
    meta.put("agentUserId", agentUserId);
    meta.put("agentUsername", user.username());
    if (previousId != null) {
      meta.put("previousAgentUserId", previousId);
      meta.put("previousAgentUsername", usernameOf(previousId));
    }
    audit(adminId, "WORKSPACE_ASSISTANT_SET", "공용 비서 지정: " + user.username(), meta);
  }

  /** 공용 비서 부분 설정 변경(WP-139) — 요청에 있는 필드만. 미지정 상태면 예외. */
  public void updateSettings(long adminId, UpdateAssistantSettingsRequest req) {
    long agentId =
        workspaceRepo
            .findAgentId()
            .orElseThrow(() -> new IllegalStateException("공용 비서가 설정되지 않았어요."));
    settingsWriter.apply(agentId, req);
    // 요청에 들어온 필드만 바뀐 값으로 남긴다(null 은 「기본값·자동으로 되돌림」).
    Map<String, Object> changed = new LinkedHashMap<>();
    changed.put("agentUserId", agentId);
    if (req.hasModel()) changed.put("model", req.model());
    if (req.hasThinkingDepth()) changed.put("thinkingDepth", req.thinkingDepth());
    if (req.hasSuggestionModel()) changed.put("suggestionModel", req.suggestionModel());
    if (req.hasVision())
      changed.put("vision", req.vision() == null ? null : req.vision().toString());
    audit(
        adminId,
        "WORKSPACE_ASSISTANT_SETTINGS_CHANGED",
        "공용 비서 설정 변경: " + usernameOf(agentId),
        changed);
  }

  /** 공용 비서 지정 해제 — 행 삭제(미지정 상태). 지정돼 있던 때만 감사 기록을 남긴다. */
  @Transactional
  public void clear(long adminId) {
    var previousId = workspaceRepo.findAgentId();
    workspaceRepo.deleteAssistant();
    previousId.ifPresent(
        id -> {
          String name = usernameOf(id);
          Map<String, Object> meta = new LinkedHashMap<>();
          meta.put("agentUserId", id);
          meta.put("agentUsername", name);
          audit(adminId, "WORKSPACE_ASSISTANT_CLEARED", "공용 비서 해제: " + name, meta);
        });
  }

  /**
   * 공용 비서 지정·해제·설정 변경 감사 기록(WP-706). 공용 비서는 워크스페이스 모든 구성원의 AI 대화가 쓰는 AI·AI 연결을 정하므로 누가 언제 무엇으로 바꿨는지
   * 남긴다. resourceId 는 대상 AI id.
   */
  private void audit(
      long adminId, String actionType, String description, Map<String, Object> meta) {
    auditLogService.log(
        adminId,
        usernameOf(adminId),
        actionType,
        "workspace_assistant",
        String.valueOf(meta.get("agentUserId")),
        description,
        null,
        null,
        "SUCCESS",
        null,
        meta);
  }

  private String usernameOf(long userId) {
    return userRepository
        .findById(userId)
        .map(UserResponse::username)
        .orElse(String.valueOf(userId));
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
