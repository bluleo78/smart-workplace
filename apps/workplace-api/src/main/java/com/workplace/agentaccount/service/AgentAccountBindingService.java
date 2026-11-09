package com.workplace.agentaccount.service;

import com.workplace.agentaccount.dto.AgentAccountResponse;
import com.workplace.agentaccount.dto.AgentAccountRow;
import com.workplace.agentaccount.exception.AgentAccountBindingException;
import com.workplace.agentaccount.exception.AgentAccountNotFoundException;
import com.workplace.agentaccount.repository.AgentAccountBindingRepository;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.agentruntime.dto.AgentTemplate;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.service.AgentAccountFit;
import com.workplace.agentruntime.service.AgentTemplateRegistry;
import com.workplace.user.dto.AgentUsernames;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.service.WorkspaceMemberGuard;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI → 계정 묶기 서비스(WP-1448) — 작업 공간(Pod) 실행 방식 AI 가 계정 목록의 계정 하나를 가리키게 한다. 묶인 계정은 runner 계약에서 AI 의 활성
 * 연결보다 먼저다({@link AgentAccountPodSource}).
 *
 * <p>묶기 규칙(순서대로): AI 가 이 워크스페이스 구성원인 AI(아니면 404) → 개인 비서 아님(400) → 실행 설정 행 있음(작업 공간 방식, 409) → 계정이
 * 이 워크스페이스의 살아 있는 계정(404) → 실행 템플릿이 있고(409) 그 템플릿이 요구하는 계정 종류({@link AgentAccountFit#fits}, 400).
 *
 * <p>실행 설정 행 → 계정 행 순으로 잠근 뒤 묶는다. 실행 설정 행 잠금은 실행 방식 전환·실행 설정 삭제(같은 행을 {@code findForUpdate} 로 잠근다)와
 * 차례로 서게 한다 — 전환이 묶음을 푼 직후 묶기가 끼어들어 다른 방식이 된 AI 에 묶음이 남지 않게. 계정 행 잠금은 폐기({@link
 * AgentAccountService#revoke})도 같은 행을 잠그고 「쓰는 AI 있음」을 확인하므로, 폐기 확인과 실제 폐기 사이에 묶기가 끼어들지 못한다.
 *
 * <p>묶기·옮기기·풀기는 runner 에 알린다({@link AgentAccountRuntimeNotifier}) — generation 은 그대로지만 desired 의
 * 비밀값 버전이 바뀐다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class AgentAccountBindingService {

  private final AgentAccountRepository accounts;
  private final AgentAccountBindingRepository bindings;
  private final AgentAccountService accountService;
  private final AgentRuntimeSettingRepository settings;
  private final AgentTemplateRegistry registry;
  private final WorkspaceMemberGuard memberGuard;
  private final AgentAccountRuntimeNotifier runtimeNotifier;

  /**
   * AI 를 계정에 묶는다(이미 다른 계정에 묶였으면 옮긴다). 같은 계정에 다시 묶으면 아무것도 바꾸지 않는다(runner 알림도 없음).
   *
   * @return 묶은 계정의 메타(쓰는 AI 포함)
   */
  public AgentAccountResponse bind(Long callerId, long agentUserId, long accountId) {
    bind(callerId, agentUserId, accountId, null);
    return accountService.get(accountId);
  }

  /**
   * 응답 없이 묶는다 — 규칙·잠금·감사 로그·runner 알림은 {@link #bind(Long, long, long)} 와 같다. 응답을 버리는 기존 연결 등록
   * 다리({@link AgentAccountPodSource#bindFromLegacy})가 계정 응답 조회(계정·묶음·사용자)를 하지 않게 따로 둔다.
   */
  void bindWithoutResponse(Long callerId, long agentUserId, long accountId) {
    bind(callerId, agentUserId, accountId, null);
  }

  /**
   * 기존 연결 이관 백필(WP-1448, {@link AgentAccountBackfill})의 묶기 — 규칙·잠금·감사 로그는 {@link #bind(Long, long,
   * long)} 와 같고 두 가지가 다르다.
   *
   * <ul>
   *   <li>버전을 이어받는다 — 옛 연결 id 와 지금 계정 secret_version 을 묶음에 남겨, runner 가 받는 claude/login 버전이 이관 전과
   *       똑같게 한다({@link AgentAccountPodSource}). 서버 쪽 이관 때문에 일하던 Pod 가 다시 만들어지지 않게(설계의 실패 조건).
   *   <li>runner 에 알리지 않는다 — 버전이 그대로라 할 일이 없다.
   * </ul>
   *
   * <p>백필은 응답을 쓰지 않으므로 계정 응답을 만들지 않는다(AI 마다 응답 조회를 하지 않게).
   *
   * @param legacyCredentialId 그 AI 의 활성 옛 연결 id(이관 전 runner 버전의 원천)
   */
  public void bindFromBackfill(long agentUserId, long accountId, long legacyCredentialId) {
    bind(null, agentUserId, accountId, legacyCredentialId);
  }

  /**
   * 묶기 본체. legacyCredentialId 가 있으면 이관 백필이다 — 버전 이어받기 칸을 채우고 runner 에 알리지 않는다. 없으면 이어받기 칸을 지우고(다른
   * 계정으로 옮기면 그 계정의 버전으로) runner 에 알린다. 같은 계정에 다시 묶으면 아무것도 바꾸지 않는다(이어받기도 그대로 — 바뀐 것이 없으니 Pod 를 갈 까닭이
   * 없다). 응답은 만들지 않는다 — 응답이 필요한 공개 {@link #bind(Long, long, long)} 만 만든다.
   */
  private void bind(Long callerId, long agentUserId, long accountId, Long legacyCredentialId) {
    UserResponse agent = memberGuard.requireAgent(agentUserId);
    if (AgentUsernames.isPersonalAssistant(agent.username())) {
      throw AgentAccountBindingException.personalAssistant();
    }
    // 실행 설정 행 잠금 — 실행 방식 전환·삭제(같은 행을 잠근다)와 차례로 선다. 잠금 순서는 설정 행 → 계정 행(전환 경로와 같은 방향).
    AgentRuntimeSettingRepository.Row setting =
        settings.findForUpdate(agentUserId).orElseThrow(AgentAccountBindingException::notPod);
    // 계정 행 잠금 — 동시 폐기와 차례로 선다(폐기는 같은 행을 잠그고 쓰는 AI 를 확인한다).
    AgentAccountRow account =
        accounts.findActiveForUpdate(accountId).orElseThrow(AgentAccountNotFoundException::new);
    AgentTemplate template =
        registry
            .find(setting.templateName())
            .orElseThrow(AgentAccountBindingException::templateMissing);
    if (!AgentAccountFit.fits(template, account.provider())) {
      throw AgentAccountBindingException.unfit(AgentAccountFit.unfitTemplateMessage(template));
    }
    Optional<Long> current = bindings.findAccountId(agentUserId);
    if (current.isEmpty() || current.get() != accountId) {
      boolean backfill = legacyCredentialId != null;
      bindings.upsert(
          agentUserId,
          accountId,
          callerId,
          legacyCredentialId,
          backfill ? account.secretVersion() : null);
      if (!backfill) runtimeNotifier.inputsChanged(List.of(agentUserId), callerId);
      audit(
          callerId,
          "AGENT_ACCOUNT_BOUND",
          agentUserId,
          "AI 계정 묶기: " + agent.username() + " → " + account.label(),
          Map.of(
              "agent_user_id", String.valueOf(agentUserId),
              "account_id", String.valueOf(accountId),
              "previous_account_id", current.map(String::valueOf).orElse("")));
    }
  }

  /**
   * AI 의 묶음을 풀고 실제로 풀었는지 돌려준다 — 묶이지 않았어도 성공(멱등)이고, 실제로 풀었을 때만 runner 에 알린다(활성 연결이 있으면 그것으로 돌아간다).
   * 관리자 풀기와 실행 방식 전환·기존 연결 회수(WP-1448, {@link AgentAccountPodSource})가 같은 경로(감사 로그·runner 알림)를 쓴다.
   *
   * @param callerId 변경한 사람(모르면 null)
   * @return 묶여 있다가 풀렸으면 true
   */
  public boolean unbindIfBound(Long callerId, long agentUserId) {
    // 묶음이 없으면 가드 없이 바로 false — 연결 회수(사람·비구성원 대상의 멱등 noop)·실행 방식 전환이 묶이지 않은 대상에 404 를 받지 않게.
    Optional<Long> current = bindings.findAccountId(agentUserId);
    if (current.isEmpty()) return false;
    // 묶음이 있을 때만 구성원 AI 인지 본다. 사용 중지(AgentRemovalService)는 멤버십을 정지하기 전에 여기로 와서 묶음을 풀므로, 사용 중지된 AI
    // 에 묶음이 남지 않는다 — 이 가드가 404 를 던지는 것은 이 워크스페이스의 활성 구성원이 아닌 대상을 잘못 부른 경우뿐이다.
    UserResponse agent = memberGuard.requireAgent(agentUserId);
    if (bindings.delete(agentUserId) == 0) return false;
    runtimeNotifier.inputsChanged(List.of(agentUserId), callerId);
    audit(
        callerId,
        "AGENT_ACCOUNT_UNBOUND",
        agentUserId,
        "AI 계정 풀기: " + agent.username(),
        Map.of(
            "agent_user_id", String.valueOf(agentUserId),
            "account_id", String.valueOf(current.get())));
    return true;
  }

  /** AI 가 묶인 계정 메타 — 묶이지 않았으면 404(AGENT_ACCOUNT_NOT_BOUND). */
  @Transactional(readOnly = true)
  public AgentAccountResponse get(long agentUserId) {
    memberGuard.requireAgent(agentUserId);
    long accountId =
        bindings.findAccountId(agentUserId).orElseThrow(AgentAccountBindingException::notBound);
    return accountService.get(accountId);
  }

  /** 감사 로그 — 메타(AI·계정 id)만 싣는다. 행위자·기록 형식은 계정 서비스의 것을 같이 쓴다. */
  private void audit(
      Long callerId,
      String action,
      long agentUserId,
      String description,
      Map<String, String> meta) {
    accountService.logAudit(
        callerId, action, "agent_account_binding", String.valueOf(agentUserId), description, meta);
  }
}
