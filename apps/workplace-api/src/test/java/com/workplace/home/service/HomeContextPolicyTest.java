package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.home.service.HomeContextPolicy.Msg;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** HomeContextPolicy 단위 테스트(WP-232) — 비용·경계 선택·꼬리 불변식·폴백·메시지 잘림. */
class HomeContextPolicyTest {

  /** 한글 n자 본문 → 비용 n+4. */
  private static Msg m(long id, String role, int koChars) {
    return new Msg(id, role, "가".repeat(koChars));
  }

  @Test
  void 비용은_추정치_더하기_4_총합은_요약_포함() {
    assertThat(HomeContextPolicy.cost(m(1, "USER", 10))).isEqualTo(14);
    assertThat(HomeContextPolicy.total("가가", List.of(m(1, "USER", 10), m(2, "ASSISTANT", 6))))
        .isEqualTo(2 + 14 + 10);
  }

  @Test
  void 경계는_최신부터_target_이내로_남기고_앞을_요약대상으로() {
    // 각 비용 50, 6건 = 300. target 120 → 최신 2건(100) 유지, 앞 4건 요약.
    List<Msg> raw = new ArrayList<>();
    for (int i = 0; i < 6; i++) raw.add(m(i + 1, i % 2 == 0 ? "USER" : "ASSISTANT", 46));
    assertThat(HomeContextPolicy.boundary(raw, 120)).isEqualTo(4);
  }

  @Test
  void 꼬리불변식_마지막_ASSISTANT_와_그뒤_행은_target_넘어도_유지() {
    List<Msg> raw =
        List.of(
            m(1, "USER", 46),
            m(2, "ASSISTANT", 96), // 꼬리 시작(비용 100)
            m(3, "ACTION_DONE", 46),
            m(4, "ACTION_FAILED", 46));
    // target 60 이어도 꼬리 3건(200)은 모두 유지 → 경계 1.
    assertThat(HomeContextPolicy.boundary(raw, 60)).isEqualTo(1);
  }

  @Test
  void ASSISTANT_가_없으면_꼬리보호_없이_target_으로만_자른다() {
    List<Msg> raw = List.of(m(1, "USER", 46), m(2, "USER", 46), m(3, "USER", 46));
    assertThat(HomeContextPolicy.boundary(raw, 60)).isEqualTo(2);
  }

  @Test
  void 요약_청크는_오래된것부터_target_이내_접을구간_안에서_최소1건() {
    // 각 비용 50, 6건. 접을 구간 [0,5) 에서 target 120 → 2건(100).
    List<Msg> raw = new ArrayList<>();
    for (int i = 0; i < 6; i++) raw.add(m(i + 1, i % 2 == 0 ? "USER" : "ASSISTANT", 46));
    assertThat(HomeContextPolicy.chunkEnd(raw, 5, 120)).isEqualTo(2);
    // 접을 구간이 더 작으면 그 끝에서 멈춘다.
    assertThat(HomeContextPolicy.chunkEnd(raw, 1, 120)).isEqualTo(1);
    // 단건이 target 을 넘어도 최소 1건은 접는다(진행 보장).
    assertThat(HomeContextPolicy.chunkEnd(raw, 5, 30)).isEqualTo(1);
  }

  @Test
  void 폴백은_요약포함_예산에_맞게_오래된것부터_버린다() {
    List<Msg> raw = List.of(m(1, "USER", 46), m(2, "ASSISTANT", 46), m(3, "USER", 46));
    List<Msg> kept = HomeContextPolicy.dropOldestToFit("가".repeat(20), raw, 125);
    // 예산 125 - 요약 20 = 105 → 최신 2건(100) 유지.
    assertThat(kept).extracting(Msg::id).containsExactly(2L, 3L);
  }

  @Test
  void 메시지별_상한_초과_본문은_잘린다() {
    Msg capped = HomeContextPolicy.capContent(m(9, "ASSISTANT", 300), 100);
    assertThat(capped.id()).isEqualTo(9L);
    assertThat(capped.content()).endsWith("…(이하 생략)");
    assertThat(com.workplace.global.util.TokenEstimates.estimate(capped.content()))
        .isLessThanOrEqualTo(100);
    Msg nullContent = HomeContextPolicy.capContent(new Msg(1, "ASSISTANT", null), 100);
    assertThat(nullContent.content()).isNull();
  }

  @Test
  void 설정_기본값과_파생비율() {
    HomeChatProperties d = new HomeChatProperties(null);
    assertThat(d.contextTokenBudget()).isEqualTo(128_000);
    assertThat(d.summarizeTrigger()).isEqualTo(96_000);
    assertThat(d.summarizeTarget()).isEqualTo(64_000);
    assertThat(d.perMessageCap()).isEqualTo(32_000);
    assertThat(new HomeChatProperties(0).contextTokenBudget()).isEqualTo(128_000);
  }
}
