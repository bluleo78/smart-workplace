package com.workplace.auth.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.global.util.ClientIpExtractor;
import com.workplace.tenant.dto.MembershipResponse;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.dto.UserResponse;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * 아이디·비밀번호 로그인 실패를 감사 로그 「로그인 실패」(LOGIN_FAILED/FAILURE)로 남긴다(WP-1152). 전에는 잠금 카운터만 올리고 아무 기록도 없어,
 * 관리자가 「실패」로 걸러도 무차별 대입을 볼 수 없었다(SSO 실패는 이미 남는다).
 *
 * <ul>
 *   <li><b>있는 사람 계정만</b> — 없는 아이디는 누구나 아무 글자로 끝없이 만들 수 있어 남기지 않는다(SSO 의 state 오류를 남기지 않는 것과 같은 이유).
 *       AI 계정은 비밀번호 로그인을 쓰지 않아 뺀다.
 *   <li><b>잠긴 뒤의 시도는 남기지 않는다</b> — 잠기는 그 실패를 「잠김」으로 한 번 남긴다. 잠긴 동안 계속 두드려도 기록이 끝없이 늘지 않게.
 *   <li><b>그 계정의 워크스페이스에</b> — 실패 때는 들어갈 워크스페이스가 정해지지 않았다. 계정이 속한 워크스페이스마다 남겨 각 관리자 화면에 보이게 하고, 소속이
 *       없으면 워크스페이스 없는 행(운영자 열람)으로 남긴다(로그인 감사 WP-598, 공유 링크 잠금 WP-789 와 같은 기준).
 *   <li><b>요청 스레드 밖에서 쓴다</b> — 있는 계정에서만 기록 쓰기가 붙으면 응답 시간으로 계정이 있는지 드러난다(WP-623 이 같은 시간을 맞춰 둔 것). 요청
 *       스레드에서는 IP·UA 만 담아 넘기고, 소속 조회·기록은 전용 풀에서 한다. 풀이 넘치면 기록을 버린다 — 요청 스레드에서 대신 돌리면(CallerRuns) 다시
 *       시간이 갈린다.
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

  /** 있는 사람 계정의 비밀번호 로그인 실패를 남긴다. locked 면 이 실패로 계정이 잠겼다. 요청 스레드에서 부르고 곧바로 돌아온다. */
  public void recordFailed(UserResponse user, boolean locked) {
    String[] requestInfo = requestInfo();
    Long userId = user.id();
    String username = user.username();
    executor.execute(() -> write(userId, username, locked, requestInfo[0], requestInfo[1]));
  }

  /** 계정의 활성 워크스페이스마다(없으면 워크스페이스 없이) 한 행씩 남긴다. 실패해도 로그인 응답과 무관하니 경고만 남긴다. */
  private void write(Long userId, String username, boolean locked, String ip, String userAgent) {
    String description = locked ? "로그인 실패: 비밀번호를 여러 번 틀려 잠김" : "로그인 실패: 비밀번호가 올바르지 않음";
    String reason = locked ? "ACCOUNT_LOCKED" : "BAD_CREDENTIALS";
    Map<String, Object> metadata = Map.of("method", "password", "locked", locked);
    try {
      tx.executeWithoutResult(
          status -> {
            List<MembershipResponse> memberships = membershipRepository.findActiveByUser(userId);
            if (memberships.isEmpty()) {
              auditLogService.log(
                  userId,
                  username,
                  "LOGIN_FAILED",
                  "auth",
                  null,
                  description,
                  ip,
                  userAgent,
                  "FAILURE",
                  reason,
                  metadata);
              return;
            }
            for (MembershipResponse m : memberships) {
              auditLogService.logInTenant(
                  m.tenantId(),
                  userId,
                  username,
                  "LOGIN_FAILED",
                  "auth",
                  null,
                  description,
                  ip,
                  userAgent,
                  "FAILURE",
                  reason,
                  metadata);
            }
          });
    } catch (RuntimeException e) {
      log.warn("로그인 실패 감사 기록 실패 userId={} type={}", userId, e.getClass().getName());
    }
  }

  /** 요청 스레드에서 IP·UA 를 담는다 — 풀 스레드에는 요청이 없어 감사 서비스가 IP 를 찾지 못한다. */
  private static String[] requestInfo() {
    if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs) {
      HttpServletRequest req = attrs.getRequest();
      return new String[] {
        ClientIpExtractor.forAudit(ClientIpExtractor.extract(req)), req.getHeader("User-Agent")
      };
    }
    return new String[] {null, null};
  }
}
