package com.workplace.airun.context;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.json.JsonMappers;
import com.workplace.global.tenant.TenantContext;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

/** AiRunHeader 단위 테스트 — begin/encode/encodeTenantOnly (WP-1829). */
class AiRunHeaderTest {

  @BeforeEach
  @AfterEach
  void 초기화() {
    TenantContext.clear();
    SecurityContextHolder.clearContext();
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> decode(String header) {
    String json = new String(Base64.getUrlDecoder().decode(header), StandardCharsets.UTF_8);
    return JsonMappers.JACKSON2.readValue(json, Map.class);
  }

  @Test
  void 범위_맥락을_헤더로_인코딩한다() {
    TenantContext.set(7L);
    AiRunContext ctx =
        new AiRunContext(
            "MAIL_MESSAGE",
            "42",
            "제목",
            "AUTO",
            null,
            OffsetDateTime.parse("2026-11-21T09:00+09:00"));
    String header =
        AiRunScope.call(ctx, () -> AiRunHeader.encode(AiRunHeader.begin("/mail/analyze-content")));

    assertThat(header).doesNotContain("=");
    Map<String, Object> m = decode(header);
    assertThat(UUID.fromString((String) m.get("runId"))).isNotNull();
    assertThat(m)
        .containsEntry("kind", "MAIL_ANALYZE_CONTENT")
        .containsEntry("tenantId", 7)
        .containsEntry("actorType", "AUTO")
        .containsEntry("targetType", "MAIL_MESSAGE")
        .containsEntry("targetId", "42")
        .containsEntry("targetLabel", "제목")
        .containsEntry("sourceAt", "2026-11-21T09:00+09:00")
        .doesNotContainKeys("actorId", "attempt");
  }

  @Test
  void 범위가_없으면_SecurityContext_사용자를_주체로() {
    SecurityContextHolder.getContext()
        .setAuthentication(new UsernamePasswordAuthenticationToken(5L, null, java.util.List.of()));
    Map<String, Object> m = decode(AiRunHeader.encode(AiRunHeader.begin("/mail/analyze-content")));
    assertThat(m).doesNotContainKey("tenantId");
    assertThat(m).containsEntry("actorType", "USER").containsEntry("actorId", 5);
  }

  @Test
  void ROLE_AGENT_권한이면_AGENT_주체() {
    SecurityContextHolder.getContext()
        .setAuthentication(
            new UsernamePasswordAuthenticationToken(
                9L,
                null,
                java.util.List.of(
                    new org.springframework.security.core.authority.SimpleGrantedAuthority(
                        "ROLE_AGENT"))));
    Map<String, Object> m = decode(AiRunHeader.encode(AiRunHeader.begin("/mail/analyze-content")));
    assertThat(m).containsEntry("actorType", "AGENT").containsEntry("actorId", 9);
  }

  @Test
  void principal_없으면_AUTO() {
    Map<String, Object> m = decode(AiRunHeader.encode(AiRunHeader.begin("/mail/analyze-content")));
    assertThat(m).containsEntry("actorType", "AUTO").doesNotContainKey("actorId");
  }

  @Test
  void 표에_없는_경로는_kind를_뺀다() {
    Map<String, Object> m = decode(AiRunHeader.encode(AiRunHeader.begin("/models")));
    assertThat(m).doesNotContainKey("kind");
  }

  @Test
  void begin마다_runId가_다르다() {
    assertThat(AiRunHeader.begin("/ai/chat").runId())
        .isNotEqualTo(AiRunHeader.begin("/ai/chat").runId());
  }

  @Test
  void 테넌트만_인코딩() {
    assertThat(decode(AiRunHeader.encodeTenantOnly(3L))).isEqualTo(Map.of("tenantId", 3));
    assertThat(AiRunHeader.encodeTenantOnly(null)).isNull();
  }
}
