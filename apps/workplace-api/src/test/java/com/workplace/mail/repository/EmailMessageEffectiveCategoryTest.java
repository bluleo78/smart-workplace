package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.mail.service.MailAnalysisFixtures.LONG_BODY;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.service.MailAnalysisFixtures;
import com.workplace.mail.service.MailAnalysisFixtures.Box;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.jooq.Record2;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1341 유효 분류 — 직접 바꾼 분류(사본) > 개인 비서 분류(사본) > 검증된 공용 분류(원본). 목록·상세·업무/분류 보기·「분류 전」이 한 정의를 쓰고, 사본
 * 분류가 같은 원본을 받은 동료에게 새지 않는지 본다. V266 기존 데이터 되돌리기도 함께 본다.
 */
@Transactional
class EmailMessageEffectiveCategoryTest extends IntegrationTestBase {

  private static final String MIGRATION = "db/migration/V266__mail_user_category.sql";

  @Autowired DSLContext dsl;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailContentRepository contentRepo;

  private long content(String sharedCategory) {
    long id = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.AI_CATEGORY, sharedCategory)
        .where(EMAIL_CONTENT.ID.eq(id))
        .execute();
    return id;
  }

  private long envelope(Box box, long contentId) {
    return MailAnalysisFixtures.envelope(
        dsl, box, contentId, "sender@ext.com", box.address(), null);
  }

  private void setCopy(long messageId, String userCategory, String personalCategory) {
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.USER_CATEGORY, userCategory)
        .set(EMAIL_MESSAGE.AI_PERSONAL_CATEGORY, personalCategory)
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .execute();
  }

  private EmailMessageSummary row(Box box, long messageId) {
    return messageRepo
        .listByAccount(box.accountId(), "INBOX", null, false, null, false, 100)
        .stream()
        .filter(r -> r.id() == messageId)
        .findFirst()
        .orElseThrow();
  }

  private List<Long> view(Box box, String category) {
    return messageRepo
        .listByAccount(box.accountId(), "INBOX", null, false, category, false, 100)
        .stream()
        .map(EmailMessageSummary::id)
        .toList();
  }

  /** 셋 다 있으면 직접 분류, 직접 분류가 없으면 개인 비서 분류, 둘 다 없으면 공용 분류. */
  @Test
  void effectiveCategory_prefersUserThenPersonalThenShared() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long all = envelope(box, content("업무"));
    setCopy(all, "뉴스레터", "알림");
    long personal = envelope(box, content("업무"));
    setCopy(personal, null, "알림");
    long shared = envelope(box, content("업무"));

    assertThat(row(box, all).aiCategory()).isEqualTo("뉴스레터");
    assertThat(row(box, all).categoryByMe()).isTrue();
    assertThat(row(box, personal).aiCategory()).isEqualTo("알림");
    assertThat(row(box, personal).categoryByMe()).isFalse();
    assertThat(row(box, shared).aiCategory()).isEqualTo("업무");
    assertThat(row(box, shared).categoryByMe()).isFalse();

    EmailMessageDetail d = messageRepo.findDetailByIdAndUser(box.userId(), all).orElseThrow();
    assertThat(d.aiCategory()).isEqualTo("뉴스레터");
    assertThat(d.categoryByMe()).isTrue();
    EmailMessageDetail p = messageRepo.findDetailByIdAndUser(box.userId(), personal).orElseThrow();
    assertThat(p.aiCategory()).isEqualTo("알림");
    assertThat(p.categoryByMe()).isFalse();
  }

  /** 같은 원본을 받은 동료(B) 목록에는 A 가 직접 바꾼 분류가 보이지 않는다(Review Focus 1). */
  @Test
  void effectiveCategory_isPerCopy_whenTwoOwnersShareContent() {
    Box a = MailAnalysisFixtures.mailbox(dsl, true);
    Box b = MailAnalysisFixtures.mailbox(dsl, true);
    long c = content("업무");
    long mine = envelope(a, c);
    long theirs = envelope(b, c);
    setCopy(mine, "뉴스레터", "프로모션");

    assertThat(row(a, mine).aiCategory()).isEqualTo("뉴스레터");
    assertThat(row(b, theirs).aiCategory()).isEqualTo("업무");
    assertThat(row(b, theirs).categoryByMe()).isFalse();
    assertThat(view(b, "업무")).contains(theirs);
    assertThat(view(b, "뉴스레터")).doesNotContain(theirs);
    assertThat(messageRepo.countUnreadAggregate(b.accountId()).byCategory().get("업무"))
        .isEqualTo(1L);
    assertThat(messageRepo.countUnreadAggregate(a.accountId()).byCategory().get("뉴스레터"))
        .isEqualTo(1L);
  }

  /** 직접 뉴스레터로 바꾼 메일은 공용 분류가 업무여도 업무 보기·업무 안 읽은 수에서 빠진다. */
  @Test
  void workView_excludesMail_whenUserCategoryIsNewsletter() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long m = envelope(box, content("업무"));
    setCopy(m, "뉴스레터", null);

    assertThat(view(box, "업무")).doesNotContain(m);
    assertThat(view(box, "뉴스레터")).contains(m);
    assertThat(messageRepo.countUnreadWork(box.accountId())).isZero();
  }

  /** 개인 비서 분류가 맞으면 공용 분류와 달라도 그 분류 보기에 들어간다. */
  @Test
  void categoryView_includesMail_whenPersonalCategoryMatches() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long m = envelope(box, content("뉴스레터"));
    setCopy(m, null, "업무");

    assertThat(view(box, "업무")).contains(m);
    assertThat(view(box, "뉴스레터")).doesNotContain(m);
  }

  /** 내 분류가 있으면 공용 분류를 아직 시도하지 않았어도 「분류 전」이 아니다. */
  @Test
  void categoryPending_isFalse_whenUserCategorySet() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long pending = envelope(box, content(null));
    long mine = envelope(box, content(null));
    setCopy(mine, "개인", null);

    assertThat(row(box, pending).categoryPending()).isTrue();
    assertThat(row(box, mine).categoryPending()).isFalse();
  }

  /**
   * WP-1347 과 함께 — 공용 분류가 재시도를 모두 소진해 최종 실패(분류 NULL·시도 시각 있음)여도 내가 고른 분류나 개인 비서 분류가 있으면 「분류 전」도
   * 「분류하지 못했어요」도 아니다. 사본 분류가 없는 같은 상태의 메일만 둘 다 true 다.
   */
  @Test
  void categoryPendingAndFailed_areFalse_whenCopyCategorySet_evenIfSharedFailed() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long failed = envelope(box, failedContent());
    long mine = envelope(box, failedContent());
    setCopy(mine, "업무", null);
    long personal = envelope(box, failedContent());
    setCopy(personal, null, "알림");

    assertThat(row(box, failed).categoryPending()).isTrue();
    assertThat(row(box, failed).categoryFailed()).isTrue();
    assertThat(row(box, mine).categoryPending()).isFalse();
    assertThat(row(box, mine).categoryFailed()).isFalse();
    assertThat(row(box, personal).categoryPending()).isFalse();
    assertThat(row(box, personal).categoryFailed()).isFalse();
  }

  /** 분류 일괄이 재시도를 모두 소진한 원본(분류 NULL·시도 시각 있음, WP-1347 최종 실패). */
  private long failedContent() {
    long id = content(null);
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.AI_CATEGORIZED_AT, OffsetDateTime.now())
        .set(EMAIL_CONTENT.AI_CATEGORY_ATTEMPTS, (short) 4)
        .where(EMAIL_CONTENT.ID.eq(id))
        .execute();
    return id;
  }

  /**
   * V266 — (광고) 제목의 업무·개인 분류, 사내 구성원이 보낸 뉴스레터·프로모션만 재분류 대상(분류·시도 시각 NULL, 재시도 상태 0·NULL)으로 되돌린다. 빈
   * 결과로 끝난 원본은 건드리지 않는다 — 그 되돌리기는 WP-1347 의 V265(최근 14일) 한 규칙이 맡는다. 빈 DB 에서 돈 마이그레이션은 대상이 없어 시드 뒤
   * 같은 파일의 UPDATE 문만 다시 실행한다(테스트 DB 사용자는 테이블 소유자가 아니라 ALTER 를 못 한다).
   */
  @Test
  void migrationV266_resetsAdAndMemberNewsletter() throws IOException {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    TestFixtures.activeMemberOfCurrentTenant(dsl, box.userId());
    String member = box.address().toUpperCase(); // 대소문자 무시 비교 확인

    long adWork = categorized("(광고) 우리가 [일하는 사이]", "업무");
    long adNewsletter = categorized("[광고] 소식", "뉴스레터");
    long memberNewsletter = categorized("iA_CLOUD_DAILY_MARKET_BRIEF_261028", "뉴스레터");
    long memberAdPromotion = categorized("(광고) 사내 행사", "프로모션");
    long externalNewsletter = categorized("주간 소식", "뉴스레터");
    long emptyResult = categorized("아무 메일", null);
    long work = categorized("회의록", "업무");
    // 되돌린 원본은 재시도 상태도 처음으로 — WP-1347 규칙(ai_categorized_at 을 NULL 로 되돌리면 시도 횟수 0)
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.AI_CATEGORY_ATTEMPTS, (short) 2)
        .set(EMAIL_CONTENT.AI_CATEGORY_NEXT_ATTEMPT_AT, OffsetDateTime.now().plusHours(6))
        .where(EMAIL_CONTENT.ID.eq(adWork))
        .execute();

    MailAnalysisFixtures.envelope(dsl, box, adWork, "ad@ext.com", box.address(), null);
    MailAnalysisFixtures.envelope(dsl, box, adNewsletter, "ad@ext.com", box.address(), null);
    MailAnalysisFixtures.envelope(dsl, box, memberNewsletter, member, box.address(), null);
    MailAnalysisFixtures.envelope(dsl, box, memberAdPromotion, member, box.address(), null);
    MailAnalysisFixtures.envelope(dsl, box, externalNewsletter, "n@ext.com", box.address(), null);
    MailAnalysisFixtures.envelope(dsl, box, emptyResult, "x@ext.com", box.address(), null);
    MailAnalysisFixtures.envelope(dsl, box, work, "w@ext.com", box.address(), null);

    runMigrationUpdates();

    assertReset(adWork);
    assertReset(memberNewsletter);
    assertThat(
            dsl.select(
                    EMAIL_CONTENT.AI_CATEGORY_ATTEMPTS, EMAIL_CONTENT.AI_CATEGORY_NEXT_ATTEMPT_AT)
                .from(EMAIL_CONTENT)
                .where(EMAIL_CONTENT.ID.eq(adWork))
                .fetchOne())
        .satisfies(
            r -> {
              assertThat(r.value1()).isEqualTo((short) 0);
              assertThat(r.value2()).isNull();
            });
    // 빈 결과로 끝난 원본은 V266 이 되돌리지 않는다(WP-1347 V265 의 14일 규칙 하나만)
    assertKept(emptyResult, null);
    assertKept(adNewsletter, "뉴스레터");
    assertKept(memberAdPromotion, "프로모션");
    assertKept(externalNewsletter, "뉴스레터");
    assertKept(work, "업무");
  }

  /**
   * V266 의 데이터 되돌리기(UPDATE 문 — CTE 로 시작하는 WITH … UPDATE 포함)만 실행한다. 주석 줄을 지우고 문장 단위로 나눈다(정규식에 ';' 가
   * 없다).
   */
  private void runMigrationUpdates() throws IOException {
    String sql = new ClassPathResource(MIGRATION).getContentAsString(StandardCharsets.UTF_8);
    String noComments =
        Arrays.stream(sql.split("\n"))
            .filter(line -> !line.trim().startsWith("--"))
            .collect(Collectors.joining("\n"));
    for (String stmt : noComments.split(";")) {
      String head = stmt.trim();
      if (head.startsWith("UPDATE") || head.startsWith("WITH")) {
        dsl.execute(stmt);
      }
    }
  }

  /** 분류 일괄이 시도한 원본(시도 시각 기록) — category null 이면 빈 결과로 끝난 원본. */
  private long categorized(String subject, String category) {
    long id = content(category);
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.SUBJECT, subject)
        .set(EMAIL_CONTENT.AI_CATEGORIZED_AT, OffsetDateTime.now())
        .where(EMAIL_CONTENT.ID.eq(id))
        .execute();
    return id;
  }

  private Record2<String, OffsetDateTime> state(long contentId) {
    return dsl.select(EMAIL_CONTENT.AI_CATEGORY, EMAIL_CONTENT.AI_CATEGORIZED_AT)
        .from(EMAIL_CONTENT)
        .where(EMAIL_CONTENT.ID.eq(contentId))
        .fetchOne();
  }

  private void assertReset(long contentId) {
    Record2<String, OffsetDateTime> s = state(contentId);
    assertThat(s.value1()).isNull();
    assertThat(s.value2()).isNull();
  }

  private void assertKept(long contentId, String category) {
    Record2<String, OffsetDateTime> s = state(contentId);
    assertThat(s.value1()).isEqualTo(category);
    assertThat(s.value2()).isNotNull();
  }
}
