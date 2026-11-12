package com.workplace.help.service;

import static com.workplace.help.service.ManualGapMarker.endsWithGap;
import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** 답변 끝 manual-gap 표식 판정 시험(WP-1512) — 웹 helpAnswer.ts splitFooterOf 규칙과 같아야 한다. */
class ManualGapMarkerTest {

  @Test
  void gapFooterAlone() {
    assertThat(endsWithGap("못 찾았습니다.\n\n[매뉴얼 보강](manual-gap:)")).isTrue();
  }

  @Test
  void gapWithSourceSameLine() {
    assertThat(endsWithGap("본문\n\n[도움말 · 위젯](help:home.widgets) · [매뉴얼 보강](manual-gap:)")).isTrue();
  }

  @Test
  void sourceOnlyIsNotGap() {
    assertThat(endsWithGap("본문\n\n[도움말 · 위젯](help:home.widgets)")).isFalse();
  }

  @Test
  void gapMidTextIsNotGap() {
    assertThat(endsWithGap("여기 [매뉴얼 보강](manual-gap:) 을 보세요\n\n끝 문단")).isFalse();
  }

  @Test
  void extraWordsInFooter() {
    assertThat(endsWithGap("본문\n\n참고: [매뉴얼 보강](manual-gap:)")).isFalse();
  }

  @Test
  void insideCodeFenceIsNot() {
    assertThat(endsWithGap("```\n[매뉴얼 보강](manual-gap:)\n```")).isFalse();
  }

  @Test
  void footerRightAfterClosedFenceOrHeadingIsGap() {
    // 웹 파서에서는 닫힌 펜스·제목 다음 줄이 별도 문단이라 꼬리줄로 보인다 — 서버도 같게 센다.
    assertThat(endsWithGap("본문\n\n```\ncode\n```\n[매뉴얼 보강](manual-gap:)")).isTrue();
    assertThat(endsWithGap("## 제목\n[매뉴얼 보강](manual-gap:)")).isTrue();
  }

  @Test
  void upperCaseSchemeIsNot() {
    assertThat(endsWithGap("본문\n\n[매뉴얼 보강](MANUAL-GAP:)")).isFalse();
  }

  @Test
  void nullOrBlank() {
    assertThat(endsWithGap(null)).isFalse();
    assertThat(endsWithGap("  ")).isFalse();
  }
}
