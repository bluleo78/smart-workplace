package com.workplace.wiki.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.MovePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiSpaceResponse;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageCreatedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageDeletedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageMovedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageUpdatedEvent;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 생성·수정·삭제·이동 시 도메인 이벤트 발행 검증(#724).
 *
 * <p>기존에는 생성/수정이 어떤 이벤트도 발행하지 않아 AI 비서/타 세션의 노트 변경이 SSE 로 실시간 반영되지 않던 갭을 메운 수정을 검증한다. AFTER_COMMIT
 * 리스너(WikiSseDispatcher) 는 @Transactional 롤백 테스트에서 실행되지 않으므로, 여기서는 서비스가 이벤트를 publish 하는지만
 * ApplicationEvents 로 확인한다(dispatcher fan-out 은 WikiSseDispatcherTest + 라이브 검증에서 별도 확인).
 */
@RecordApplicationEvents
@Transactional
class WikiPageServiceEventTest extends IntegrationTestBase {

  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired DSLContext dsl;
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
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "we_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "We" + s)
        .set(USER.EMAIL, "we_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void create_publishesWikiPageCreatedEvent() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);

    WikiPageDetail page = pageService.create(u, sp.id(), new CreatePageRequest(null, "생성 이벤트"));

    var created = events.stream(WikiPageCreatedEvent.class).toList();
    assertThat(created).hasSize(1);
    assertThat(created.get(0).spaceId()).isEqualTo(sp.id());
    assertThat(created.get(0).pageId()).isEqualTo(page.id());
    assertThat(created.get(0).title()).isEqualTo("생성 이벤트");
    assertThat(created.get(0).actorId()).isEqualTo(u);
  }

  @Test
  void save_publishesWikiPageUpdatedEvent() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    WikiPageDetail page = pageService.create(u, sp.id(), new CreatePageRequest(null, "원본"));

    pageService.save(u, page.id(), new SavePageRequest("수정된 제목", "본문 내용", page.version(), false));

    var updated = events.stream(WikiPageUpdatedEvent.class).toList();
    assertThat(updated).hasSize(1);
    assertThat(updated.get(0).spaceId()).isEqualTo(sp.id());
    assertThat(updated.get(0).pageId()).isEqualTo(page.id());
    assertThat(updated.get(0).title()).isEqualTo("수정된 제목");
  }

  @Test
  void delete_publishesWikiPageDeletedEvent() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    WikiPageDetail page = pageService.create(u, sp.id(), new CreatePageRequest(null, "삭제될 노트"));

    pageService.delete(u, page.id());

    var deleted = events.stream(WikiPageDeletedEvent.class).toList();
    assertThat(deleted).hasSize(1);
    assertThat(deleted.get(0).spaceId()).isEqualTo(sp.id());
    assertThat(deleted.get(0).pageId()).isEqualTo(page.id());
  }

  @Test
  void move_publishesWikiPageMovedEvent() {
    long u = seedUser();
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    WikiPageDetail parent = pageService.create(u, sp.id(), new CreatePageRequest(null, "부모"));
    WikiPageDetail child = pageService.create(u, sp.id(), new CreatePageRequest(null, "자식"));

    pageService.move(u, child.id(), new MovePageRequest(parent.id(), 0));

    var moved = events.stream(WikiPageMovedEvent.class).toList();
    assertThat(moved).hasSize(1);
    assertThat(moved.get(0).spaceId()).isEqualTo(sp.id());
    assertThat(moved.get(0).pageId()).isEqualTo(child.id());
  }
}
