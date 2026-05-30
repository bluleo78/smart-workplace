package com.workplace.chat.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class ChatThreadMemberRepositoryTest extends IntegrationTestBase {

  @Autowired ChatThreadMemberRepository memberRepo;
  @Autowired ChatThreadService threadService;
  @Autowired ChatFixtures fx;

  @Test
  void findMemberIds_returnsAllMembers() {
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());

    List<Long> ids = memberRepo.findMemberIds(thread.threadId());

    assertThat(ids).contains(s.reporterId());
  }
}
