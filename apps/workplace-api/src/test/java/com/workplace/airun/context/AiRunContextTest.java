package com.workplace.airun.context;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.security.InternalOnBehalfOf;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

/** AiRunContext 주체 판정 단위 테스트 — SecurityContext·callerId·Internal 대행 표식 (WP-1829). */
class AiRunContextTest {

  @BeforeEach
  @AfterEach
  void 초기화() {
    SecurityContextHolder.clearContext();
  }

  @Test
  void principal이_사용자_id면_USER() {
    SecurityContextHolder.getContext()
        .setAuthentication(new UsernamePasswordAuthenticationToken(7L, null, List.of()));

    AiRunContext ctx = AiRunContext.actorFromSecurity(3L);

    assertThat(ctx.actorType()).isEqualTo("USER");
    assertThat(ctx.actorId()).isEqualTo(7L);
  }

  /** callerId 로 주체를 못 정할 때만 쓴다 — SecurityContext 가 있으면 그 쪽이 이긴다. */
  @Test
  void 인증이_없으면_callerId로_USER() {
    AiRunContext ctx = AiRunContext.actorFromSecurity(5L);

    assertThat(ctx.actorType()).isEqualTo("USER");
    assertThat(ctx.actorId()).isEqualTo(5L);
  }

  /** principal 이 사용자 id 가 아니면 AUTO 로 떨어지지 않고 호출부가 확정한 사람으로 남는다(WP-1829 리뷰 후속). */
  @Test
  void principal이_사용자_id가_아니면_callerId로_USER() {
    SecurityContextHolder.getContext()
        .setAuthentication(new UsernamePasswordAuthenticationToken("익명", null, List.of()));

    AiRunContext ctx = AiRunContext.actorFromSecurity(5L);

    assertThat(ctx.actorType()).isEqualTo("USER");
    assertThat(ctx.actorId()).isEqualTo(5L);
  }

  @Test
  void 인증도_callerId도_없으면_AUTO() {
    AiRunContext ctx = AiRunContext.actorFromSecurity();

    assertThat(ctx.actorType()).isEqualTo("AUTO");
    assertThat(ctx.actorId()).isNull();
  }

  @Test
  void ROLE_AGENT_권한이면_AGENT() {
    SecurityContextHolder.getContext()
        .setAuthentication(
            new UsernamePasswordAuthenticationToken(
                9L, null, List.of(new SimpleGrantedAuthority("ROLE_AGENT"))));

    AiRunContext ctx = AiRunContext.actorFromSecurity(5L);

    assertThat(ctx.actorType()).isEqualTo("AGENT");
    assertThat(ctx.actorId()).isEqualTo(9L);
  }

  /** Internal 대행 호출은 ROLE_AGENT 권한이 없지만 ai-agent 가 한 일이다(WP-1829 리뷰 후속). */
  @Test
  void 내부_대행_호출은_AGENT() {
    var auth = new UsernamePasswordAuthenticationToken(9L, null, List.of());
    auth.setDetails(InternalOnBehalfOf.INSTANCE);
    SecurityContextHolder.getContext().setAuthentication(auth);

    AiRunContext ctx = AiRunContext.actorFromSecurity(5L);

    assertThat(ctx.actorType()).isEqualTo("AGENT");
    assertThat(ctx.actorId()).isEqualTo(9L);
  }
}
