package com.workplace.auth.service;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.service.UserService;
import java.sql.SQLException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 관리자의 AI 에이전트 삭제(WP-705). 일한 기록이 없으면 완전히 지우고, 기록이 남아 지울 수 없으면 사용 중지로 대신한다 — 예전엔 기록(이슈·코멘트·챗·감사 로그
 * 등)이 user 를 NO ACTION 으로 가리켜 영어 409 만 떴다.
 *
 * <p>기록이 있는지는 미리 세지 않고 savepoint 안에서 지워 본다 — user 를 가리키는 곳이 수십 곳이고 대부분 테넌트 RLS 아래라, 이 워크스페이스에서 세어도
 * 다른 워크스페이스의 기록은 보이지 않지만 FK 는 그 행까지 지킨다.
 */
@Service
public class AgentRemovalService {

  /** 삭제 결과 — 화면 토스트가 이 값으로 갈린다. */
  public enum Result {
    /** 완전히 지웠다. */
    DELETED,
    /** 기록이 남았거나 다른 워크스페이스에도 속해 있어 이 워크스페이스에서 사용을 중지했다. */
    DEACTIVATED
  }

  /** PostgreSQL foreign_key_violation. */
  private static final String FK_VIOLATION = "23503";

  private final UserService userService;
  private final WorkspaceAssistantRepository workspaceAssistant;
  private final MembershipRepository memberships;
  private final AgentApiKeyRepository apiKeys;
  private final AiAgentCredentialService credentials;
  private final TransactionTemplate savepoint;

  public AgentRemovalService(
      UserService userService,
      WorkspaceAssistantRepository workspaceAssistant,
      MembershipRepository memberships,
      AgentApiKeyRepository apiKeys,
      AiAgentCredentialService credentials,
      PlatformTransactionManager txManager) {
    this.userService = userService;
    this.workspaceAssistant = workspaceAssistant;
    this.memberships = memberships;
    this.apiKeys = apiKeys;
    this.credentials = credentials;
    // 바깥 트랜잭션 안의 savepoint — 삭제가 FK 에 막혀도 그 지점까지만 되돌리고 사용 중지로 이어 간다.
    this.savepoint = new TransactionTemplate(txManager);
    this.savepoint.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
  }

  /**
   * AGENT 를 지우거나, 지울 수 없으면 사용을 중지한다. 순서: 확인(비멤버 404·AGENT 아님 400·개인 비서 403) → 공통 비서였으면 지정 해제(어느 쪽이든
   * 남긴다) → 다른 워크스페이스 멤버십이 없으면 완전 삭제 시도 → 막히면 사용 중지.
   */
  @Transactional
  public Result remove(long callerId, long agentId) {
    UserResponse agent = userService.requireRemovableAgent(agentId);
    long tenantId = TenantContext.require();
    if (workspaceAssistant.findAgentId().filter(id -> id == agentId).isPresent()) {
      workspaceAssistant.deleteAssistant();
    }
    // user 행은 전역이라 지우면 다른 워크스페이스에서도 사라진다(멤버십은 CASCADE) — 그때는 이 워크스페이스에서만 사용을 중지한다.
    if (!memberships.hasMembershipElsewhere(agentId, tenantId) && tryDelete(callerId, agentId)) {
      return Result.DELETED;
    }
    deactivate(callerId, agent);
    return Result.DEACTIVATED;
  }

  /** savepoint 안에서 완전 삭제를 시도한다. 기록이 남아 FK 에 막히면 false — 다른 무결성 위반은 그대로 던진다. */
  private boolean tryDelete(long callerId, long agentId) {
    try {
      savepoint.executeWithoutResult(s -> userService.deleteAgent(callerId, agentId));
      return true;
    } catch (DataIntegrityViolationException e) {
      if (isForeignKeyViolation(e)) return false;
      throw e;
    }
  }

  /**
   * 사용 중지 — 이 워크스페이스 멤버십을 정지(열린 연결 닫기·「구성원 정지」 감사 기록 포함, WP-417)하고, 다른 워크스페이스에서 쓰고 있지 않으면 API 키·AI
   * 연결도 회수한다(키·연결은 워크스페이스 구분 없이 AI 에 붙는다 — 멤버십이 하나도 없는 키도 테넌트 없이 인증은 된다).
   */
  private void deactivate(long callerId, UserResponse agent) {
    userService.setUserActive(agent.id(), false, callerId);
    if (memberships.findActiveByUser(agent.id()).isEmpty()) {
      apiKeys.revokeAllActive(agent.id());
      credentials.revoke(callerId, agent.id());
    }
  }

  private static boolean isForeignKeyViolation(Throwable e) {
    for (Throwable t = e; t != null; t = t.getCause()) {
      if (t instanceof SQLException sql && FK_VIOLATION.equals(sql.getSQLState())) return true;
    }
    return false;
  }
}
