package com.workplace.chat.outbound;

import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.chat.repository.ChatMessageRepository;
import com.workplace.chat.repository.ChatThreadRepository;
import com.workplace.chat.service.ChatFixtures;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.outbound.dto.ChatExcerpt;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.JSONB;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * IssueChatExcerptReaderImpl 통합 테스트. 비-@Transactional(커밋) 방식으로 실행해 GUC 주입이 포함된 전체 경로를 검증한다. RLS-안전
 * 정리를 위해 cleanupInTenant 를 사용한다. 이슈·프로젝트는 ChatFixtures 를 통해 시드한다.
 */
class IssueChatExcerptReaderImplTest extends IntegrationTestBase {

  @Autowired IssueChatExcerptReaderImpl reader;
  @Autowired ChatFixtures fx;
  @Autowired ChatThreadRepository threadRepo;
  @Autowired ChatMessageRepository messageRepo;

  private static final long TENANT_ID = 1L;

  /** 추가 시드한 AGENT 사용자 ID(정리용). */
  private Long extraAgentId;

  @AfterEach
  void cleanup() {
    // 먼저 project/issue/message 를 CASCADE 포함 정리한 후 참조된 user 를 삭제해야 FK 위반을 피한다.
    fx.cleanupAll();
    if (extraAgentId != null) {
      baseDsl.deleteFrom(USER).where(USER.ID.eq(extraAgentId)).execute();
      extraAgentId = null;
    }
  }

  /** 채팅 스레드가 없는 이슈 → 빈 리스트 반환. */
  @Test
  void noThread_returnsEmptyList() {
    ChatFixtures.Setup s = fx.setup();

    TenantContext.set(TENANT_ID);
    try {
      List<ChatExcerpt> result = reader.recentForIssue(s.issueId(), 50);
      assertThat(result).isEmpty();
    } finally {
      TenantContext.clear();
    }
  }

  /** 메시지 3개 중 1개 soft-delete — 비삭제 2개만 오름차순으로 반환. authorName, authorKind, body 일치 검증. */
  @Test
  void messagesWithOneSoftDeleted_returnsNonDeletedInAscOrder() {
    ChatFixtures.Setup s = fx.setup();

    // 에이전트 사용자 추가.
    String agentSuffix = UUID.randomUUID().toString().substring(0, 6);
    String agentName = "agent_" + agentSuffix;
    extraAgentId = insertAgentUserRaw(agentName);

    // chat_thread + 메시지 3개(1개 soft-delete) 시드.
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              TenantContext.set(TENANT_ID);

              // 스레드 생성 (insertIfAbsent — ON CONFLICT DO NOTHING).
              long threadId = threadRepo.insertIfAbsent(s.issueId());

              // 메시지 1: 사용자(USER kind) 작성.
              messageRepo.insert(threadId, s.reporterId(), "첫 번째 메시지", List.of());

              // 메시지 2: 에이전트(AGENT kind) 작성.
              messageRepo.insert(threadId, extraAgentId, "두 번째 메시지(에이전트)", List.of());

              // 메시지 3: soft-delete 처리 — 조회에서 제외되어야 함.
              long deletedId =
                  baseDsl
                      .insertInto(CHAT_MESSAGE)
                      .set(CHAT_MESSAGE.THREAD_ID, threadId)
                      .set(CHAT_MESSAGE.AUTHOR_ID, s.reporterId())
                      .set(CHAT_MESSAGE.BODY, "삭제된 메시지")
                      .set(CHAT_MESSAGE.MENTIONS, JSONB.valueOf("[]"))
                      .returning(CHAT_MESSAGE.ID)
                      .fetchOne()
                      .getId();
              baseDsl
                  .update(CHAT_MESSAGE)
                  .set(CHAT_MESSAGE.DELETED_AT, java.time.OffsetDateTime.now())
                  .where(CHAT_MESSAGE.ID.eq(deletedId))
                  .execute();
            });

    // when
    TenantContext.set(TENANT_ID);
    try {
      List<ChatExcerpt> result = reader.recentForIssue(s.issueId(), 50);

      // then: 삭제된 메시지 1개 제외하고 2개 반환, 시간 오름차순.
      assertThat(result).hasSize(2);

      // 첫 메시지(사용자, 오름차순 첫 번째).
      ChatExcerpt first = result.get(0);
      assertThat(first.authorName()).startsWith("rep"); // ChatFixtures 가 'rep' + suffix 로 생성
      assertThat(first.authorKind()).isEqualTo("HUMAN"); // 일반 사용자의 kind 값은 "HUMAN"
      assertThat(first.body()).isEqualTo("첫 번째 메시지");
      assertThat(first.createdAt()).isNotNull();

      // 두 번째 메시지(에이전트, 오름차순 두 번째).
      ChatExcerpt second = result.get(1);
      assertThat(second.authorName()).isEqualTo(agentName);
      assertThat(second.authorKind()).isEqualTo("AGENT");
      assertThat(second.body()).isEqualTo("두 번째 메시지(에이전트)");

      // 세 번째(soft-delete)는 제외됨 — size 2 로 확인 완료.
    } finally {
      TenantContext.clear();
    }
  }

  /** USER 테이블에 AGENT kind 로 INSERT. */
  private Long insertAgentUserRaw(String username) {
    return baseDsl
        .insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, username)
        .set(USER.EMAIL, username + "@example.com")
        .set(USER.KIND, "AGENT")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }
}
