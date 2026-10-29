package com.workplace.auth.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.service.PasswordLoginVerifier.LoginFailureReason;
import com.workplace.global.util.RequestInfo;
import com.workplace.tenant.dto.MembershipResponse;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.dto.UserResponse;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 아이디·비밀번호 로그인 실패를 감사 로그 「로그인 실패」(LOGIN_FAILED/FAILURE)로 남긴다(WP-1152). 전에는 잠금 카운터만 올리고 아무 기록도 없어,
 * 관리자가 「실패」로 걸러도 무차별 대입을 볼 수 없었다(SSO 실패는 이미 남는다).
 *
 * <ul>
 *   <li><b>있는 사람 계정만</b> — 없는 아이디는 누구나 아무 글자로 끝없이 만들 수 있어 남기지 않는다(SSO 의 state 오류를 남기지 않는 것과 같은 이유).
 *       AI 계정은 비밀번호 로그인을 쓰지 않아 뺀다.
 *   <li><b>잠긴 뒤의 시도는 남기지 않는다</b> — 잠기는 그 실패를 「잠김」으로 한 번 남긴다. 잠긴 동안 계속 두드려도 기록이 끝없이 늘지 않게.
 *   <li><b>사유를 나눈다</b>(WP-1161) — 틀린 비밀번호·비밀번호 로그인을 쓰지 않는(SSO 전용) 계정·잠김.
 *   <li><b>그 계정의 워크스페이스에</b> — 실패 때는 들어갈 워크스페이스가 정해지지 않았다. 계정이 속한 워크스페이스마다 남겨 각 관리자 화면에 보이게 하고, 소속이
 *       없으면 워크스페이스 없는 행(운영자 열람)으로 남긴다(로그인 감사 WP-598, 공유 링크 잠금 WP-789 와 같은 기준). 운영자 로그인 실패는 운영자 로그인
 *       성공(PLATFORM_LOGIN)과 같은 워크스페이스 없는 행에 더해 그 계정의 워크스페이스에도 「(운영자 로그인)」을 붙여 남긴다 — 잠금 카운터를 함께
 *       써서(WP-1161).
 *   <li><b>요청 스레드 밖에서 쓴다</b> — 있는 계정에서만 기록 쓰기가 붙으면 응답 시간으로 계정이 있는지 드러난다(WP-623 이 같은 시간을 맞춰 둔 것). 요청
 *       정보(IP·UA)는 호출자가 계정 유무와 상관없이 검증 전에 뽑아 넘기고, 소속 조회·기록은 전용 풀에서 한다. 풀이 넘치면 기록을 버리고 건수만 센다({@link
 *       LoginAuditConfig}) — 요청 스레드에서 대신 돌리면(CallerRuns) 다시 시간이 갈린다.
 * </ul>
 */
@Slf4j
@Component
public class LoginFailureAuditor {

  private final AuditLogService auditLogService;
  private final MembershipRepository membershipRepository;
  private final TransactionTemplate tx;
  private final Executor executor;

  public LoginFailureAuditor(
      AuditLogService auditLogService,
      MembershipRepository membershipRepository,
      PlatformTransactionManager txManager,
      @Qualifier(LoginAuditConfig.EXECUTOR) Executor executor) {
    this.auditLogService = auditLogService;
    this.membershipRepository = membershipRepository;
    this.tx = new TransactionTemplate(txManager);
    this.executor = executor;
  }

  /** 일반 로그인의 실패를 그 계정의 워크스페이스마다 남긴다. 요청 스레드에서 부르고 곧바로 돌아온다. */
  public void recordFailed(UserResponse user, LoginFailureReason reason, RequestInfo request) {
    Long userId = user.id();
    String username = user.username();
    executor.execute(
        () ->
            write(
                () -> logInWorkspaces(userId, username, description(reason), reason, request, true),
                userId));
  }

  /**
   * 운영자(플랫폼) 로그인의 실패를 남긴다 — 운영자 로그인 성공 감사와 같은 워크스페이스 없는 행(PLATFORM_LOGIN_FAILED)에 더해, 그 계정의
   * 워크스페이스에도 남긴다. 운영자 로그인은 일반 로그인과 잠금 카운터를 함께 써, 운영자 화면으로 두드려 잠긴 것도 그 계정의 워크스페이스 관리자가 볼 수 있어야 한다.
   * 곧바로 돌아온다.
   */
  public void recordPlatformFailed(
      UserResponse user, LoginFailureReason reason, RequestInfo request) {
    Long userId = user.id();
    String username = user.username();
    executor.execute(
        () ->
            write(
                () -> {
                  logFailed(
                      null,
                      userId,
                      username,
                      "PLATFORM_LOGIN_FAILED",
                      "platform",
                      description(reason),
                      reason,
                      request);
                  // 워크스페이스 없는 행은 위 PLATFORM_LOGIN_FAILED 가 맡는다.
                  logInWorkspaces(
                      userId, username, description(reason) + " (운영자 로그인)", reason, request, false);
                },
                userId));
  }

  /** 계정의 활성 워크스페이스마다 「로그인 실패」 한 행씩 남긴다. 소속이 없으면 globalIfNone 일 때만 워크스페이스 없는 행으로 남긴다. */
  private void logInWorkspaces(
      Long userId,
      String username,
      String description,
      LoginFailureReason reason,
      RequestInfo request,
      boolean globalIfNone) {
    List<MembershipResponse> memberships = membershipRepository.findActiveByUser(userId);
    if (memberships.isEmpty() && globalIfNone) {
      logFailed(null, userId, username, "LOGIN_FAILED", "auth", description, reason, request);
    }
    for (MembershipResponse m : memberships) {
      logFailed(
          m.tenantId(), userId, username, "LOGIN_FAILED", "auth", description, reason, request);
    }
  }

  /** 풀 스레드에서 트랜잭션 하나로 쓴다. 실패해도 로그인 응답과 무관하니 경고만 남긴다. */
  private void write(Runnable body, Long userId) {
    try {
      tx.executeWithoutResult(status -> body.run());
    } catch (RuntimeException e) {
      log.warn("로그인 실패 감사 기록 실패 userId={} type={}", userId, e.getClass().getName());
    }
  }

  private void logFailed(
      Long tenantId,
      Long userId,
      String username,
      String action,
      String resource,
      String description,
      LoginFailureReason reason,
      RequestInfo request) {
    auditLogService.logInTenantOrGlobal(
        tenantId,
        userId,
        username,
        action,
        resource,
        description,
        request,
        "FAILURE",
        reasonCode(reason),
        Map.of("method", "password", "locked", reason == LoginFailureReason.LOCKED));
  }

  /** 감사 설명 — 관리자 화면에 그대로 보인다. */
  static String description(LoginFailureReason reason) {
    return switch (reason) {
      case BAD_PASSWORD -> "로그인 실패: 비밀번호가 올바르지 않음";
      case NO_PASSWORD -> "로그인 실패: 비밀번호 로그인을 쓰지 않는 계정(SSO 전용)";
      case LOCKED -> "로그인 실패: 비밀번호를 여러 번 틀려 잠김";
    };
  }

  /** 감사 오류 코드(error_message). */
  private static String reasonCode(LoginFailureReason reason) {
    return switch (reason) {
      case BAD_PASSWORD -> "BAD_CREDENTIALS";
      case NO_PASSWORD -> "PASSWORD_LOGIN_DISABLED";
      case LOCKED -> "ACCOUNT_LOCKED";
    };
  }
}
