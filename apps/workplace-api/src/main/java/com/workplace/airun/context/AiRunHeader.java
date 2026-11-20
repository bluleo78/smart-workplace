package com.workplace.airun.context;

import com.workplace.global.json.JsonMappers;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.tenant.TenantContext;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * API → ai-agent 호출에 싣는 X-AI-Run 헤더 값을 만든다 (WP-1829).
 *
 * <p>값 = base64url(JSON), 패딩 없음. 필드 이름은 ai-agent header.ts 와 같고 null 필드는 뺀다. runId 는 호출마다 새로 만들어
 * ai-agent 가 같은 runId 로 보고하는 기록과 API 의 실패 기록이 합쳐지게 한다.
 */
public final class AiRunHeader {

  /** 헤더 이름. */
  public static final String NAME = "X-AI-Run";

  private AiRunHeader() {}

  /** 호출 한 번의 정보. kind 는 표에 없는 경로면 null. */
  public record Call(
      UUID runId,
      String kind,
      Long tenantId,
      String actorType,
      Long actorId,
      AiRunContext ctx,
      OffsetDateTime startedAt) {
    /** ctx 는 한 번만 널 정규화한다 — 읽는 쪽이 매번 null 을 따지지 않게 (WP-1829). */
    public Call {
      ctx = ctx != null ? ctx : AiRunContext.empty();
    }
  }

  /**
   * 경로에 대한 호출 정보를 새로 만든다. 주체는 범위가 정했으면 그것, 아니면 SecurityContext principal(Long) → USER(ROLE_AGENT
   * 권한이면 AGENT), 그 밖엔 AUTO.
   */
  public static Call begin(String path) {
    AiRunContext ctx = AiRunScope.current();
    String actorType = ctx.actorType();
    Long actorId = ctx.actorId();
    if (actorType == null) {
      Authentication auth = SecurityContextHolder.getContext().getAuthentication();
      if (auth != null && auth.getPrincipal() instanceof Long userId) {
        // AI 키·PAT 인증은 principal 이 사용자 id 지만 ROLE_AGENT 권한이 붙는다 — 사람이 아니라 AGENT 가 한 일로 남긴다.
        boolean agent =
            auth.getAuthorities().stream()
                .anyMatch(a -> ApiKeyAuthenticationFilter.ROLE_AGENT.equals(a.getAuthority()));
        actorType = agent ? "AGENT" : "USER";
        actorId = userId;
      } else {
        actorType = "AUTO";
        actorId = null;
      }
    }
    return new Call(
        UUID.randomUUID(),
        AiRunKinds.kindForPath(path).orElse(null),
        TenantContext.get(),
        actorType,
        actorId,
        ctx,
        OffsetDateTime.now());
  }

  /** 호출 정보를 헤더 값(base64url JSON, 패딩 없음)으로 인코딩한다. */
  public static String encode(Call call) {
    Map<String, Object> m = new LinkedHashMap<>();
    put(m, "runId", call.runId().toString());
    put(m, "kind", call.kind());
    put(m, "tenantId", call.tenantId());
    put(m, "actorType", call.actorType());
    put(m, "actorId", call.actorId());
    AiRunContext ctx = call.ctx();
    put(m, "targetType", ctx.targetType());
    put(m, "targetId", ctx.targetId());
    put(m, "targetLabel", ctx.targetLabel());
    put(m, "sourceAt", ctx.sourceAt() != null ? ctx.sourceAt().toString() : null);
    return toBase64(m);
  }

  /** 이벤트 클라이언트용 — tenantId 만 담은 헤더 값. tenantId 가 null 이면 null. */
  public static String encodeTenantOnly(Long tenantId) {
    if (tenantId == null) {
      return null;
    }
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("tenantId", tenantId);
    return toBase64(m);
  }

  private static void put(Map<String, Object> m, String key, Object value) {
    if (value != null) {
      m.put(key, value);
    }
  }

  private static String toBase64(Map<String, Object> m) {
    String json = JsonMappers.JACKSON2.writeValueAsString(m);
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(json.getBytes(StandardCharsets.UTF_8));
  }
}
