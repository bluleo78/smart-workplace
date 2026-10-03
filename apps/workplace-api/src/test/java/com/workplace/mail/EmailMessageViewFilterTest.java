package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.tables.EmailContent.EMAIL_CONTENT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** WP-186 업무 보기 조건 — 업무 ∪ 미분류 ∪ 미적재, 그리고 목록 행의 categoryPending. */
@Transactional
class EmailMessageViewFilterTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailContentRepository contentRepo;

  /** 적재·검증된 사본 1통을 만들고 category 가 null 이 아니면 content 에 분류를 기록한다. */
  private long fetched(long accountId, long folderId, String category) {
    String key = "m-" + System.nanoTime();
    ParsedMessage msg =
        new ParsedMessage(
            System.nanoTime(),
            key,
            "t-" + key,
            null,
            null,
            "sender@example.com",
            null,
            null,
            null,
            "제목",
            Instant.now(),
            Instant.now(),
            false,
            false,
            null,
            null,
            "스니펫",
            List.of());
    long env = messageRepo.insertIgnoreConflict(accountId, folderId, msg).orElseThrow();
    Long content = contentIdOf(env);
    contentRepo.updateBody(content, "본문", null, "스니펫");
    TestFixtures.markMailFetched(dsl, env);
    if (category != null) {
      dsl.update(EMAIL_CONTENT)
          .set(EMAIL_CONTENT.AI_CATEGORY, category)
          .where(EMAIL_CONTENT.ID.eq(content))
          .execute();
    }
    return env;
  }

  private Long contentIdOf(long env) {
    return dsl.select(EMAIL_MESSAGE.CONTENT_ID)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(env))
        .fetchOneInto(Long.class);
  }

  private List<Long> ids(List<EmailMessageSummary> rows) {
    return rows.stream().map(EmailMessageSummary::id).toList();
  }

  @Test
  void work_includesUncategorizedAndUnfetched_excludesOtherCategories() {
    long[] box = TestFixtures.seedMailbox(dsl, "view-" + System.nanoTime() + "@test.local");
    long work = fetched(box[1], box[2], "업무");
    long none = fetched(box[1], box[2], null);
    long personal = fetched(box[1], box[2], "개인");
    long unfetched = fetched(box[1], box[2], "개인");
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.FETCHED_AT, (OffsetDateTime) null)
        .where(EMAIL_MESSAGE.ID.eq(unfetched))
        .execute();

    var rows = messageRepo.listByAccount(box[1], "INBOX", null, false, "업무", false, 50);

    assertThat(ids(rows)).contains(work, none, unfetched).doesNotContain(personal);
  }

  @Test
  void otherCategory_unchanged_requiresFetched() {
    long[] box = TestFixtures.seedMailbox(dsl, "view2-" + System.nanoTime() + "@test.local");
    long personal = fetched(box[1], box[2], "개인");
    long none = fetched(box[1], box[2], null);

    var rows = messageRepo.listByAccount(box[1], "INBOX", null, false, "개인", false, 50);

    assertThat(ids(rows)).containsExactly(personal).doesNotContain(none);
  }

  @Test
  void categoryPending_trueOnlyWhenNeverAttempted() {
    long[] box = TestFixtures.seedMailbox(dsl, "view3-" + System.nanoTime() + "@test.local");
    long fresh = fetched(box[1], box[2], null);
    long attempted = fetched(box[1], box[2], null);
    long classified = fetched(box[1], box[2], "업무");
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.AI_CATEGORIZED_AT, OffsetDateTime.now())
        .where(EMAIL_CONTENT.ID.eq(contentIdOf(attempted)))
        .execute();

    var byId =
        messageRepo.listByAccount(box[1], "INBOX", null, false, null, false, 50).stream()
            .collect(
                Collectors.toMap(EmailMessageSummary::id, EmailMessageSummary::categoryPending));

    assertThat(byId.get(fresh)).isTrue();
    assertThat(byId.get(attempted)).isFalse();
    assertThat(byId.get(classified)).isFalse();
  }
}
