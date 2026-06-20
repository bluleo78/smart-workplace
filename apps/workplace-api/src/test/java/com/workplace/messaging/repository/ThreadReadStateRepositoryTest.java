package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** ThreadReadStateRepository 통합 테스트 — 팔로우 upsert + 미읽음 집계. */
@Transactional
class ThreadReadStateRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ChannelRepository channelRepo;
  @Autowired MessageRepository messageRepo;
  @Autowired ThreadReadStateRepository repo;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "trs_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Trs" + s)
        .set(USER.EMAIL, "trs_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** followIfAbsent 는 watermark NULL 로 행 생성, 재호출 시 watermark 보존. */
  @Test
  void followIfAbsent_createsRowThenPreserves() {
    long author = seedUser();
    long reader = seedUser();
    long ch = channelRepo.insertPublic("일반", author);
    channelService.join(author, ch);
    channelService.join(reader, ch);
    long root = messageService.create(author, ch, new CreateMessageRequest("부모")).id();

    repo.followIfAbsent(root, reader);
    assertThat(repo.followedRoots(List.of(root), reader)).containsExactly(root);

    // 먼저 watermark 를 올려두고, followIfAbsent 재호출이 이를 덮지 않음을 확인.
    repo.markRead(root, reader, 999_999L);
    repo.followIfAbsent(root, reader);
    assertThat(repo.countUnreadForRoots(List.of(root), reader)).doesNotContainKey(root);
  }

  /** 미읽음 = 작성자≠나 & id>watermark & 삭제아님. */
  @Test
  void countUnread_respectsWatermarkAuthorAndDeleted() {
    long author = seedUser();
    long reader = seedUser();
    long ch = channelRepo.insertPublic("일반", author);
    channelService.join(author, ch);
    channelService.join(reader, ch);
    long root = messageService.create(author, ch, new CreateMessageRequest("부모")).id();

    // reader 가 root 를 팔로우(watermark 없음).
    repo.followIfAbsent(root, reader);
    // author 가 답글 2개 작성.
    long r1 = messageService.create(author, ch, new CreateMessageRequest("답1", root)).id();
    long r2 = messageService.create(author, ch, new CreateMessageRequest("답2", root)).id();

    assertThat(repo.countUnreadForRoots(List.of(root), reader)).containsEntry(root, 2);

    // watermark 를 r1 로 올리면 미읽음 1개(r2).
    repo.markRead(root, reader, r1);
    assertThat(repo.countUnreadForRoots(List.of(root), reader)).containsEntry(root, 1);

    // reader 본인이 답글을 작성하면 markRead(watermark=본인 답글 id)가 자동 호출되어 r2도 읽음 처리됨.
    // 즉 미읽음 0개(watermark가 r2보다 높고, 본인 답글 자체는 author_id 조건으로 제외).
    messageService.create(reader, ch, new CreateMessageRequest("reader답", root));
    assertThat(repo.countUnreadForRoots(List.of(root), reader)).doesNotContainKey(root);
  }

  /**
   * author_id 제외 필터를 직접 격리 검증. 자동 팔로우(watermark 전진)를 우회하려고 답글을 messageRepo.insert 로 직접 삽입한다 —
   * watermark 0 에서도 본인(reader) 작성 답글은 미읽음에 안 잡히고, 타인(author) 답글만 잡힌다.
   */
  @Test
  void countUnread_excludesSelfAuthoredReplies_atZeroWatermark() {
    long author = seedUser();
    long reader = seedUser();
    long ch = channelRepo.insertPublic("일반", author);
    channelService.join(author, ch);
    channelService.join(reader, ch);
    long root = messageService.create(author, ch, new CreateMessageRequest("부모")).id();

    // reader 가 팔로우(watermark 0 유지).
    repo.followIfAbsent(root, reader);
    // messageRepo.insert 로 답글 직접 삽입 → MessageService 의 자동 팔로우/markRead 를 타지 않아 watermark 가 0 으로 고정.
    messageRepo.insert(ch, reader, "reader 답글", List.of(), root); // 본인 답글 → author_id 조건으로 제외돼야
    messageRepo.insert(ch, author, "author 답글", List.of(), root); // 타인 답글 → 미읽음 1

    // watermark 0 이지만 본인 답글은 제외되고 author 답글만 미읽음 → 정확히 1.
    assertThat(repo.countUnreadForRoots(List.of(root), reader)).containsEntry(root, 1);
  }
}
