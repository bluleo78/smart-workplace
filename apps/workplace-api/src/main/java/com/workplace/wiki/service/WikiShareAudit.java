package com.workplace.wiki.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 공유 감사 로그(WP-579, 설계 「기록·감사」) — 관리자 설정 › 감사 로그에서 액션·리소스로 거르는 기록. 리소스는 {@code wiki}, resourceId
 * 는 페이지 id, metadata 에는 언제나 spaceId 와 호출자가 넘긴 값(audience·permission 과 액션별 추가 값)을 담는다.
 *
 * <p>행위자는 지금 요청의 사용자다(관리자가 일으킨 일괄 해제·정책 끔도 그 관리자). 요청 사용자가 없으면(스케줄러·비동기 리스너) userId null·username
 * {@code system}. 공유 변경과 같은 트랜잭션에서만 쓴다 — 변경이 롤백되면 감사도 함께 사라져야 한다.
 */
@Component
@RequiredArgsConstructor
public class WikiShareAudit {
  public static final String CREATED = "WIKI_SHARE_CREATED";
  public static final String UPDATED = "WIKI_SHARE_UPDATED";
  public static final String PEOPLE_CHANGED = "WIKI_SHARE_PEOPLE_CHANGED";
  public static final String REGENERATED = "WIKI_SHARE_REGENERATED";
  public static final String REVOKED = "WIKI_SHARE_REVOKED";
  public static final String ACCESS_DENIED = "WIKI_SHARE_ACCESS_DENIED";
  public static final String POLICY_CHANGED = "WIKI_SHARE_POLICY_CHANGED";

  /** 감사 로그 description — 설계 표의 라벨(웹 auditLogLabels 와 같은 말). */
  private static final Map<String, String> LABELS =
      Map.of(
          POLICY_CHANGED, "노트 외부 공유 설정 변경",
          CREATED, "노트 공유 생성",
          UPDATED, "노트 공유 변경",
          PEOPLE_CHANGED, "노트 공유 대상 변경",
          REGENERATED, "노트 공유 링크 재발급",
          REVOKED, "노트 공유 해제",
          ACCESS_DENIED, "노트 공유 요청 거절");

  private final AuditLogService auditLogService;
  private final UserRepository userRepository;

  /**
   * 감사 로그 한 건.
   *
   * @param actionType 설계 표의 actionType(이 클래스의 상수)
   * @param extra audience·permission 과 액션별 추가 metadata(null 값 허용)
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public void log(String actionType, long pageId, long spaceId, Map<String, Object> extra) {
    Map<String, Object> metadata = new LinkedHashMap<>();
    metadata.put("spaceId", spaceId);
    metadata.putAll(extra);
    write(actionType, "wiki", String.valueOf(pageId), metadata);
  }

  /**
   * 관리자의 외부 공유 스위치 변경(리소스 {@code tenant}, resourceId = 워크스페이스 id) — 끄면서 함께 해제된 외부 공유 수를 남긴다. 해제된
   * 페이지마다의 {@link #REVOKED}(reason POLICY)는 따로 쓴다.
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public void logPolicyChanged(long tenantId, boolean externalShareEnabled, int revokedCount) {
    Map<String, Object> metadata = new LinkedHashMap<>();
    metadata.put("externalShareEnabled", externalShareEnabled);
    metadata.put("revokedCount", revokedCount);
    write(POLICY_CHANGED, "tenant", String.valueOf(tenantId), metadata);
  }

  private void write(
      String actionType, String resource, String resourceId, Map<String, Object> metadata) {
    Long actorId = currentActorId();
    String username =
        actorId == null
            ? "system"
            : userRepository.findById(actorId).map(UserResponse::username).orElse("system");
    auditLogService.log(
        actorId,
        username,
        actionType,
        resource,
        resourceId,
        LABELS.getOrDefault(actionType, actionType),
        null,
        null,
        "SUCCESS",
        null,
        metadata);
  }

  /**
   * 요청 사용자 id — 인증 principal 은 Long userId 다. 없으면 null(시스템). 시스템이 일으킨 해제(멤버십·삭제)는 공유 기록의 행위자도 이 값으로
   * 남겨 감사 로그의 행위자와 같은 사람이 되게 한다({@link WikiShareLifecycle}).
   */
  static Long currentActorId() {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    return auth != null && auth.getPrincipal() instanceof Long id ? id : null;
  }
}
