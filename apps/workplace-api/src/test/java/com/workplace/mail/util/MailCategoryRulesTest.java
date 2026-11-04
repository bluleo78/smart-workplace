package com.workplace.mail.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** WP-1340·1342 메일 분류 결정적 보정 — 광고 표기 제목·사내 구성원 발신 규칙과 그 우선순위. */
class MailCategoryRulesTest {

  /** 「(광고)」 제목인데 모델이 업무라고 하면 프로모션으로 바로잡는다. */
  @Test
  void adjust_returnsPromotion_whenAdSubjectAndWork() {
    assertThat(MailCategoryRules.adjust("업무", "(광고) 이벤트", false)).isEqualTo("프로모션");
  }

  /** 광고 제목이어도 뉴스레터는 기대 동작(프로모션 또는 뉴스레터)이라 그대로 둔다. */
  @Test
  void adjust_keepsNewsletter_whenAdSubject() {
    assertThat(MailCategoryRules.adjust("뉴스레터", "[광고] 소식", false)).isEqualTo("뉴스레터");
  }

  /** 광고 제목인데 분류가 비었으면(모델이 허용 밖 이름을 냄) 프로모션으로 채운다. */
  @Test
  void adjust_returnsPromotion_whenAdSubjectAndNull() {
    assertThat(MailCategoryRules.adjust(null, "  ( 광고 ) 특가", false)).isEqualTo("프로모션");
  }

  /** 사내 구성원이 보낸 정기 공유물은 뉴스레터가 아니라 업무다. */
  @Test
  void adjust_returnsWork_whenMemberAndNewsletter() {
    assertThat(MailCategoryRules.adjust("뉴스레터", "iA_CLOUD_DAILY_MARKET_BRIEF_261028", true))
        .isEqualTo("업무");
    assertThat(MailCategoryRules.adjust("프로모션", "사내 행사 안내", true)).isEqualTo("업무");
  }

  /** 사내 구성원이 보냈어도 알림·개인은 그대로 둔다. */
  @Test
  void adjust_keepsNotice_whenMember() {
    assertThat(MailCategoryRules.adjust("알림", "빌드 실패", true)).isEqualTo("알림");
    assertThat(MailCategoryRules.adjust("개인", "점심", true)).isEqualTo("개인");
  }

  /** 사내 구성원이 보낸 (광고) 메일은 광고 규칙이 먼저다(Review Focus 3). */
  @Test
  void adjust_prefersAdRule_whenMemberSendsAd() {
    assertThat(MailCategoryRules.adjust("업무", "(광고) x", true)).isEqualTo("프로모션");
    assertThat(MailCategoryRules.adjust("뉴스레터", "(광고) x", true)).isEqualTo("뉴스레터");
  }

  /** 어떤 규칙에도 걸리지 않으면 입력 그대로(빈 값은 빈 값). */
  @Test
  void adjust_keepsNull_whenNoRule() {
    assertThat(MailCategoryRules.adjust(null, "회의록 공유", false)).isNull();
    assertThat(MailCategoryRules.adjust(null, "회의록 공유", true)).isNull();
    assertThat(MailCategoryRules.adjust("업무", "광고 문의 드립니다", false)).isEqualTo("업무");
  }

  /** 광고 표기는 제목 맨 앞(앞 공백 허용)만 본다. */
  @Test
  void isAd_matchesOnlyLeadingMark() {
    assertThat(MailCategoryRules.isAd("(광고) 우리가 [일하는 사이]")).isTrue();
    assertThat(MailCategoryRules.isAd(" [광고]소식")).isTrue();
    assertThat(MailCategoryRules.isAd("Re: (광고) 소식")).isFalse();
    assertThat(MailCategoryRules.isAd(null)).isFalse();
  }

  /** 개인 비서 분류에는 광고 규칙만 적용한다 — 사내 구성원 규칙은 사용자가 학습시킨 기억(사내 주간 소식을 뉴스레터로)을 덮는다. */
  @Test
  void adjustForPersonal_keepsNewsletter_whenMember() {
    assertThat(MailCategoryRules.adjustForPersonal("뉴스레터", "주간 사내 소식")).isEqualTo("뉴스레터");
    assertThat(MailCategoryRules.adjustForPersonal("프로모션", "사내 행사 안내")).isEqualTo("프로모션");
  }

  /** 개인 비서 분류에도 광고 규칙은 그대로 — 광고 제목인데 업무면 프로모션, 뉴스레터는 그대로. */
  @Test
  void adjustForPersonal_appliesAdRule() {
    assertThat(MailCategoryRules.adjustForPersonal("업무", "(광고) 특가")).isEqualTo("프로모션");
    assertThat(MailCategoryRules.adjustForPersonal("뉴스레터", "[광고] 소식")).isEqualTo("뉴스레터");
    assertThat(MailCategoryRules.adjustForPersonal(null, "회의록")).isNull();
  }
}
