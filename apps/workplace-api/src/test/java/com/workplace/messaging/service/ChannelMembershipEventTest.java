package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.outbound.MessagingDomainEvents.ChannelArchivedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.ChannelMembershipChangedEvent;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/** 채널 멤버/보관 변경이 도메인 이벤트를 발행하는지 검증. */
@Transactional
@RecordApplicationEvents
class ChannelMembershipEventTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired ChannelMemberService memberService;
  @Autowired ApplicationEvents events;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "cme_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Cme" + s)
            .set(USER.EMAIL, "cme_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  @Test
  void add_publishesMembershipChanged_withFullRoster() {
    long owner = seedUser();
    long target = seedUser();
    ChannelResponse ch = channelService.create(owner, "이벤트채널", "PRIVATE");

    memberService.add(owner, ch.id(), target);

    var published =
        events.stream(ChannelMembershipChangedEvent.class)
            .filter(e -> e.channelId() == ch.id())
            .toList();
    assertThat(published).isNotEmpty();
    var last = published.get(published.size() - 1);
    // roster 에 owner + target 둘 다 포함.
    assertThat(last.members().stream().map(ChannelMembershipChangedEvent.Member::userId))
        .contains(owner, target);
  }

  @Test
  void archive_publishesChannelArchived() {
    long owner = seedUser();
    ChannelResponse ch = channelService.create(owner, "보관채널", "PRIVATE");
    channelService.archive(owner, ch.id());

    assertThat(
            events.stream(ChannelArchivedEvent.class)
                .filter(e -> e.channelId() == ch.id() && e.archived()))
        .isNotEmpty();
  }
}
