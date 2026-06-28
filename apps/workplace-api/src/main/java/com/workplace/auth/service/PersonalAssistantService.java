package com.workplace.auth.service;

import com.workplace.auth.dto.AssistantStatusResponse;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.repository.AssistantConfigRepository.ConfigRow;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.role.repository.RoleRepository;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 로그인한 본인의 개인 비서 self-service. 토큰 등록 시 per-user 개인 AGENT 를 자동 프로비저닝하고 FK 로 연결하며, 설정 변경/상태 조회/해제를 본인
 * 권한으로 수행한다. 토큰 평문/암호문은 어디서도 노출하지 않는다.
 */
@Service
@RequiredArgsConstructor
@Transactional
public class PersonalAssistantService {

  private final PersonalAssistantRepository personalRepo;
  private final AssistantConfigRepository configRepo;
  private final AiAgentCredentialService credentialService;
  private final AiAgentCredentialRepository credentialRepo;
  private final UserRepository userRepository;
  private final MembershipRepository membershipRepository;
  private final RoleRepository roleRepository;

  /** 토큰 등록/교체 — 개인 AGENT 가 없으면 자동 생성한 뒤 active 토큰을 등록(기존 active 는 자동 revoke). */
  public void registerToken(long callerId, String plaintextToken, String label) {
    long agentId = ensurePersonalAgent(callerId);
    credentialService.register(callerId, agentId, plaintextToken, label);
  }

  /** 모델/생각 깊이 변경 — maxTurns/timeoutMs 는 기존 값을 보존한다. 비서 미설정이면 예외. */
  public void updateSettings(long callerId, String model, String thinkingDepth) {
    long agentId =
        personalRepo
            .findAgentId(callerId)
            .orElseThrow(() -> new IllegalStateException("개인 비서가 설정되지 않았어요."));
    ConfigRow cur = configRepo.find(agentId).orElse(new ConfigRow(null, null, null, null));
    configRepo.upsert(agentId, model, thinkingDepth, cur.maxTurns(), cur.timeoutMs());
  }

  /** 개인 비서 표시 이름 변경 — 본인(callerId)의 비서만. 비서 미설정이면 예외. email/username 은 보존. */
  public void updateName(long callerId, String name) {
    long agentId =
        personalRepo
            .findAgentId(callerId)
            .orElseThrow(() -> new IllegalStateException("개인 비서가 설정되지 않았어요."));
    userRepository.updateName(agentId, name);
  }

  /** 개인 비서 해제 — active 토큰을 revoke 하고 FK 를 null 로 끊는다(AGENT row 는 보존). */
  public void disable(long callerId) {
    personalRepo
        .findAgentId(callerId)
        .ifPresent(
            agentId -> {
              credentialService.revoke(callerId, agentId);
              personalRepo.setAgentId(callerId, null);
            });
  }

  /** 개인 비서 상태 — FK 가 있으면 configured=true. 토큰이 없는(해제된) 경우에도 throw 없이 토큰 필드만 null 로 둔다. */
  @Transactional(readOnly = true)
  public AssistantStatusResponse getStatus(long callerId) {
    var agentOpt = personalRepo.findAgentId(callerId);
    if (agentOpt.isEmpty()) {
      return new AssistantStatusResponse(false, null, null, null, null, null);
    }
    long agentId = agentOpt.get();

    ConfigRow c = configRepo.find(agentId).orElse(new ConfigRow(null, null, null, null));
    String model = c.model() != null ? c.model() : AssistantDefaults.MODEL;
    String depth = c.thinkingDepth() != null ? c.thinkingDepth() : AssistantDefaults.THINKING_DEPTH;

    // 방어적 토큰 메타: throwing 한 getActiveMeta 대신 Optional 을 직접 조회 — FK 만 있고 토큰이 revoke 된 경우 null.
    var tokenOpt = credentialRepo.findActive(agentId);
    String label = tokenOpt.map(r -> r.label()).orElse(null);
    var lastUsedAt = tokenOpt.map(r -> r.lastUsedAt()).orElse(null);

    // 비서 표시 이름 — 프로필 화면 프리필/표시용.
    String name = userRepository.findById(agentId).map(u -> u.name()).orElse(null);

    return new AssistantStatusResponse(true, label, lastUsedAt, model, depth, name);
  }

  /**
   * caller 의 개인 AGENT 를 보장 — 없으면 생성 후 FK 연결, 있으면 재사용. 생성된/기존 AGENT id 반환.
   *
   * <p>disable() 은 FK 를 NULL 로 비우되 개인 AGENT row 는 보존한다. 그래서 FK 만으로는 "해제 후 재등록" 을 가려낼 수 없다 — 이 경우
   * 결정적 username 으로 기존 AGENT 를 찾아 재사용해야 unique 충돌(500)을 피한다.
   */
  private long ensurePersonalAgent(long callerId) {
    Optional<Long> linked = personalRepo.findAgentId(callerId);
    if (linked.isPresent()) {
      return linked.get();
    }
    String username = com.workplace.user.dto.AgentUsernames.PERSONAL_ASSISTANT_PREFIX + callerId;
    long agentId =
        userRepository
            .findByUsername(username)
            .map(u -> u.id())
            .orElseGet(
                () -> {
                  long newId =
                      userRepository.createPersonalAssistantAgent(
                          username, "assistant.u" + callerId + "@workplace.local");
                  // 신규 개인비서를 현재 active 테넌트에 귀속(콜백 RLS 컨텍스트 해석용).
                  Long tenantId = TenantContext.get();
                  if (tenantId == null) {
                    throw new IllegalStateException("개인비서 생성에는 active 테넌트 컨텍스트가 필요합니다.");
                  }
                  membershipRepository.create(newId, tenantId, "ACTIVE");
                  // #278: 개인 비서는 생성 시 기본 AGENT 역할을 받아 이슈챗 등 on-behalf 호출이 권한 게이트를 통과한다.
                  // user_role.tenant_id 는 요청 tx 의 GUC(active 테넌트)로 자동 충전된다. 역할은 테넌트별로 시드돼 있다.
                  roleRepository
                      .findByName("AGENT")
                      .ifPresent(role -> userRepository.addRole(newId, role.id()));
                  return newId;
                });
    personalRepo.setAgentId(callerId, agentId);
    return agentId;
  }
}
