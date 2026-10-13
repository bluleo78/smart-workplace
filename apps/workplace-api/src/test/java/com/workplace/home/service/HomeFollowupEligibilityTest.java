package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.service.AssistantSpec;
import com.workplace.home.service.HomeFollowupService.FollowupInput;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * 후속 질문 대상 판정(WP-139 스펙 §5.1) 순수 단위 테스트 — 스프링·DB 없이 HomeFollowupService.eligible 의 분기만 본다. 통합
 * 테스트(HomeFollowupTest)가 펌프 경로를 덮고, 여기서는 출처 null(구 ai-agent 롤링 배포)·영속 실패 같은 통합으로 만들기 어려운 경우까지 고정한다.
 */
class HomeFollowupEligibilityTest {

  private static final AssistantSpec SPEC =
      new AssistantSpec(5L, "claude-sonnet-5-5", "NORMAL", 8, 60000, null);

  /** 기본은 대상인 입력 — 각 테스트가 한 필드만 바꾼다. */
  private static FollowupInput input(
      Long messageId, String answer, String source, boolean proposed) {
    return new FollowupInput(
        1L, UUID.randomUUID(), messageId, "질문", answer, source, proposed, null, SPEC);
  }

  @Test
  void 출처가_없으면_구_ai_agent_로_보고_대상이다() {
    assertThat(HomeFollowupService.eligible(input(10L, "답", null, false), true)).isTrue();
  }

  @Test
  void 일반_출처는_대상이다() {
    assertThat(HomeFollowupService.eligible(input(10L, "답", "subagent", false), true)).isTrue();
  }

  @Test
  void fallback_출처는_대상이_아니다() {
    assertThat(HomeFollowupService.eligible(input(10L, "답", "fallback", false), true)).isFalse();
  }

  @Test
  void 확인_카드가_나온_턴은_대상이_아니다() {
    assertThat(HomeFollowupService.eligible(input(10L, "답", "subagent", true), true)).isFalse();
  }

  @Test
  void 빈_답이나_공백뿐인_답은_대상이_아니다() {
    assertThat(HomeFollowupService.eligible(input(10L, "", "subagent", false), true)).isFalse();
    assertThat(HomeFollowupService.eligible(input(10L, "  \n", "subagent", false), true)).isFalse();
    assertThat(HomeFollowupService.eligible(input(10L, null, "subagent", false), true)).isFalse();
  }

  @Test
  void 영속에_실패해_메시지_id_가_없으면_대상이_아니다() {
    assertThat(HomeFollowupService.eligible(input(null, "답", "subagent", false), true)).isFalse();
  }

  @Test
  void 추천을_끈_사용자는_대상이_아니다() {
    assertThat(HomeFollowupService.eligible(input(10L, "답", "subagent", false), false)).isFalse();
  }
}
