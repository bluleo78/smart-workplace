package com.workplace.wiki;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE;
import static com.workplace.jooq.Tables.WIKI_SHARE_ACCESS_REQUEST;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.jooq.tables.records.AuditLogRecord;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.RowLockWaits;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.WikiPageShareRequest;
import com.workplace.wiki.outbound.CollabClient;
import com.workplace.wiki.outbound.CollabClient.RevalidateRequest;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiShareAccessChangedEvent;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiShareAccess;
import com.workplace.wiki.service.WikiShareService;
import com.workplace.wiki.service.WikiSpaceService;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.context.transaction.TestTransaction;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 노트 공유 설정 API(WP-579 Task 3) — 만들기·바꾸기·재발급·해제·기록·감사 로그와, 접근을 줄이는 변경이 동기화 서버 재검증을 부르는지.
 *
 * <p>쓰기는 MockMvc 로 한다 — 응답 필드 이름이 웹 {@code types/wiki.ts} 와 맞는지, 감사 로그의 행위자(요청 사용자)가 남는지를 실제 경로로
 * 본다. 클래스는 @Transactional(요청이 테스트 트랜잭션에 합류해 끝나면 롤백)이고, 커밋 후 재검증을 보는 테스트 하나만 트랜잭션 밖에서 돌며 스스로 정리한다.
 */
@Transactional
@RecordApplicationEvents
@TestPropertySource(properties = "workplace.collab.enabled=true")
class WikiShareServiceTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiShareService shareService;

  @Autowired ApplicationEvents appEvents;

  @MockitoBean CollabClient collab;

  private final List<Long> seededUserIds = new ArrayList<>();
  private long ownerId;
  private long viewerId; // 스페이스 VIEWER
  private long strangerId; // 같은 테넌트, 스페이스 비멤버
  private long p1;
  private long p2;
  private long p3;
  private long spaceId;
  private long rootId;
  private long childId;
  private long grandchildId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = human();
    viewerId = human();
    strangerId = human();
    p1 = human();
    p2 = human();
    p3 = human();
    TenantContext.set(1L);
    spaceId = spaceService.createTeamSpace(ownerId, "공유설정-" + UUID.randomUUID()).id();
    TenantContext.set(1L);
    spaceService.addMember(ownerId, spaceId, viewerId, "VIEWER");
    rootId = page(null, "제품 로드맵");
    childId = page(rootId, "1분기");
    grandchildId = page(childId, "1월");
  }

  /** 트랜잭션 밖에서 돈 테스트(커밋됨)만 직접 정리한다 — 나머지는 테스트 트랜잭션 롤백. */
  @AfterEach
  void cleanup() {
    if (!TestTransaction.isActive()) {
      cleanupInTenant(
          1L,
          () -> {
            dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(seededUserIds)).execute();
            dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.ID.eq(spaceId)).execute();
            dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(seededUserIds)).execute();
            dsl.deleteFrom(USER).where(USER.ID.in(seededUserIds)).execute();
          });
    }
    seededUserIds.clear();
    TenantContext.clear();
  }

  /** 공유를 켜면 기본값(워크스페이스 전체·보기·이 페이지만·만료 없음)으로 만들고, 기록 CREATED 1건·감사 WIKI_SHARE_CREATED 가 남는다. */
  @Test
  void create_with_default_then_get_state() throws Exception {
    JsonNode before = json(call(get(sharePath(rootId)), ownerId).andExpect(status().isOk()));
    assertThat(before.get("share").isNull()).isTrue();
    assertThat(before.get("externalShareEnabled").asBoolean()).isTrue();
    assertThat(before.get("inheritedFrom").isNull()).isTrue();
    assertThat(before.get("accessRequests").isArray()).isTrue();
    assertThat(before.get("accessRequests")).isEmpty();

    JsonNode created =
        json(
            call(save(rootId, "WORKSPACE", "VIEW", false, List.of(), null), ownerId)
                .andExpect(status().isOk()));
    String token = created.get("token").asText();
    assertThat(token).startsWith("wsh_");
    assertThat(created.get("pageId").asLong()).isEqualTo(rootId);
    assertThat(created.get("audience").asText()).isEqualTo("WORKSPACE");
    assertThat(created.get("permission").asText()).isEqualTo("VIEW");
    assertThat(created.get("includeChildren").asBoolean()).isFalse();
    assertThat(created.get("expiresAt").isNull()).isTrue();
    assertThat(created.get("people")).isEmpty();
    assertThat(created.get("createdBy").get("userId").asLong()).isEqualTo(ownerId);
    assertThat(created.get("createdBy").get("name").asText()).isEqualTo(nameOf(ownerId));
    assertThat(created.get("createdAt").asText()).isNotBlank();
    assertThat(created.get("updatedAt").asText()).isNotBlank();
    assertThat(created.get("lastAccessedAt").isNull()).isTrue();
    assertThat(created.get("viewCount").asLong()).isZero();

    call(get(sharePath(rootId)), ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.share.token").value(token))
        .andExpect(jsonPath("$.share.audience").value("WORKSPACE"));

    JsonNode events = events(rootId);
    assertThat(events).hasSize(1);
    assertThat(events.get(0).get("type").asText()).isEqualTo("CREATED");
    assertThat(events.get(0).get("actor").get("userId").asLong()).isEqualTo(ownerId);
    assertThat(events.get(0).get("actor").get("name").asText()).isEqualTo(nameOf(ownerId));
    assertThat(events.get(0).get("detail").asText()).isEqualTo("링크를 만들었습니다(워크스페이스 전체 · 보기)");
    assertThat(events.get(0).get("at").asText()).isNotBlank();
    assertThat(events.get(0).get("id").asLong()).isPositive();

    List<AuditLogRecord> audits = audits(rootId, "WIKI_SHARE_CREATED");
    assertThat(audits).hasSize(1);
    assertThat(audits.get(0).getUserId()).isEqualTo(ownerId);
    assertThat(audits.get(0).getResource()).isEqualTo("wiki");
    assertThat(audits.get(0).getDescription()).isEqualTo("노트 공유 생성");
    JsonNode meta = metadata(audits.get(0));
    assertThat(meta.get("spaceId").asLong()).isEqualTo(spaceId);
    assertThat(meta.get("audience").asText()).isEqualTo("WORKSPACE");
    assertThat(meta.get("permission").asText()).isEqualTo("VIEW");
    assertThat(meta.get("includeChildren").asBoolean()).isFalse();
    assertThat(meta.has("expiresAt")).isTrue();
    assertThat(meta.get("expiresAt").isNull()).isTrue();
    assertThat(meta.has("external")).isFalse();
  }

  /** 스페이스 VIEWER 는 공유를 보거나 바꿀 수 없다(403) — 링크 토큰도 받지 못한다. 비멤버는 404. */
  @Test
  void viewer_cannot_change_share() throws Exception {
    call(save(rootId, "WORKSPACE", "VIEW", false, List.of(), null), viewerId)
        .andExpect(status().isForbidden());
    assertThat(shareCount(rootId)).isZero();

    call(save(rootId, "WORKSPACE", "VIEW", false, List.of(), null), ownerId)
        .andExpect(status().isOk());
    call(get(sharePath(rootId)), viewerId).andExpect(status().isForbidden());
    call(post(sharePath(rootId) + "/regenerate"), viewerId).andExpect(status().isForbidden());
    call(delete(sharePath(rootId)), viewerId).andExpect(status().isForbidden());
    call(get(sharePath(rootId) + "/events"), viewerId).andExpect(status().isForbidden());
    call(save(rootId, "PUBLIC", "VIEW", false, List.of(), null), strangerId)
        .andExpect(status().isNotFound());
    call(get(sharePath(rootId)), strangerId).andExpect(status().isNotFound());
    assertThat(shareCount(rootId)).isOne();
  }

  /** 관리자가 외부 공유를 꺼 두면 외부 공개로 바꾸는 요청은 409 — 설정은 그대로이고 상태 응답도 꺼짐을 알린다. */
  @Test
  void switch_to_public_rejected_when_policy_off() throws Exception {
    call(save(rootId, "WORKSPACE", "VIEW", false, List.of(), null), ownerId)
        .andExpect(status().isOk());
    dsl.execute("UPDATE tenant SET wiki_external_share_enabled = false WHERE id = 1");

    call(save(rootId, "PUBLIC", "VIEW", false, List.of(), null), ownerId)
        .andExpect(status().isConflict());
    call(get(sharePath(rootId)), ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.externalShareEnabled").value(false))
        .andExpect(jsonPath("$.share.audience").value("WORKSPACE"));
    // 처음부터 외부로 만드는 것도 같다.
    call(save(childId, "PUBLIC", "VIEW", false, List.of(), null), ownerId)
        .andExpect(status().isConflict());
    assertThat(shareCount(childId)).isZero();
  }

  /** 외부 공개는 보기만 — 편집 요청은 400. 보기로 만들면 감사 metadata 에 external=true. */
  @Test
  void public_forces_view() throws Exception {
    call(save(rootId, "PUBLIC", "EDIT", false, List.of(), null), ownerId)
        .andExpect(status().isBadRequest());
    assertThat(shareCount(rootId)).isZero();

    OffsetDateTime in30 = OffsetDateTime.now().plusDays(30);
    call(save(rootId, "PUBLIC", "VIEW", false, List.of(), in30), ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.audience").value("PUBLIC"))
        .andExpect(jsonPath("$.permission").value("VIEW"));
    JsonNode meta = metadata(audits(rootId, "WIKI_SHARE_CREATED").get(0));
    assertThat(meta.get("external").asBoolean()).isTrue();
    assertThat(meta.get("expiresAt").asText()).isNotBlank();

    // 이미 외부인 공유를 편집으로 바꾸는 것도 400.
    call(save(rootId, "PUBLIC", "EDIT", false, List.of(), in30), ownerId)
        .andExpect(status().isBadRequest());
    // 지난 만료 시각도 400.
    call(
            save(rootId, "PUBLIC", "VIEW", false, List.of(), OffsetDateTime.now().minusDays(1)),
            ownerId)
        .andExpect(status().isBadRequest());

    // 워크스페이스 → 외부로 바꾸는 변경도 external=true.
    call(save(childId, "WORKSPACE", "VIEW", false, List.of(), null), ownerId)
        .andExpect(status().isOk());
    call(save(childId, "PUBLIC", "VIEW", false, List.of(), in30), ownerId)
        .andExpect(status().isOk());
    AuditLogRecord updated = audits(childId, "WIKI_SHARE_UPDATED").get(0);
    JsonNode changed = metadata(updated);
    assertThat(changed.get("external").asBoolean()).isTrue();
    assertThat(changed.get("audience").asText()).isEqualTo("PUBLIC");
    assertThat(changed.get("changed").get("audience").get(0).asText()).isEqualTo("WORKSPACE");
    assertThat(changed.get("changed").get("audience").get(1).asText()).isEqualTo("PUBLIC");
    assertThat(changed.get("changed").get("expiresAt").get(0).isNull()).isTrue();
    assertThat(events(childId).get(0).get("type").asText()).isEqualTo("UPDATED");
    assertThat(texts(events(childId))).contains("열 수 있는 사람을 외부 공개로 바꿨습니다");
  }

  /**
   * 공유 창은 바꾸지 않은 설정까지 늘 함께 보낸다 — 응답 그대로 다시 보내면 기록·감사가 생기지 않고(만료 시각 직렬화 왕복 포함), 이미 지난 만료를 그대로 보내며
   * 권한만 바꾸는 것도 된다. 새로 정하는 지난 만료만 400.
   */
  @Test
  void unchanged_fields_round_trip_and_expired_share_stays_editable() throws Exception {
    JsonNode created =
        json(
            call(
                    save(
                        rootId,
                        "WORKSPACE",
                        "VIEW",
                        false,
                        List.of(),
                        OffsetDateTime.now().plusDays(7)),
                    ownerId)
                .andExpect(status().isOk()));
    OffsetDateTime stored = OffsetDateTime.parse(created.get("expiresAt").asText());

    call(save(rootId, "WORKSPACE", "VIEW", false, List.of(), stored), ownerId)
        .andExpect(status().isOk());
    assertThat(events(rootId)).hasSize(1);
    assertThat(audits(rootId, "WIKI_SHARE_UPDATED")).isEmpty();

    OffsetDateTime past = OffsetDateTime.now().minusMinutes(1).truncatedTo(ChronoUnit.SECONDS);
    dsl.update(WIKI_PAGE_SHARE)
        .set(WIKI_PAGE_SHARE.EXPIRES_AT, past)
        .where(WIKI_PAGE_SHARE.PAGE_ID.eq(rootId))
        .execute();
    call(save(rootId, "WORKSPACE", "EDIT", false, List.of(), past), ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.permission").value("EDIT"));
    JsonNode events = events(rootId);
    assertThat(events).hasSize(2);
    assertThat(events.get(0).get("detail").asText()).isEqualTo("권한을 편집으로 바꿨습니다");
    JsonNode changed = metadata(audits(rootId, "WIKI_SHARE_UPDATED").get(0)).get("changed");
    assertThat(changed.has("permission")).isTrue();
    assertThat(changed.has("expiresAt")).isFalse();

    call(save(rootId, "WORKSPACE", "EDIT", false, List.of(), past.minusDays(1)), ownerId)
        .andExpect(status().isBadRequest());
  }

  /**
   * 지정한 사람을 바꾸면 추가·제외가 기록(PEOPLE_ADDED·PEOPLE_REMOVED)과 감사(added·removed)에 남는다. 구성원이 아닌 사용자는 400.
   */
  @Test
  void people_diff_records_added_removed() throws Exception {
    call(save(rootId, "PEOPLE", "VIEW", false, List.of(p1, p2), null), ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.people.length()").value(2));

    JsonNode res =
        json(
            call(save(rootId, "PEOPLE", "VIEW", false, List.of(p2, p3), null), ownerId)
                .andExpect(status().isOk()));
    Set<Long> people = new HashSet<>();
    res.get("people").forEach(p -> people.add(p.get("userId").asLong()));
    assertThat(people).containsExactlyInAnyOrder(p2, p3);
    res.get("people").forEach(p -> assertThat(p.get("name").asText()).isNotBlank());

    JsonNode events = events(rootId);
    List<String> types = new ArrayList<>();
    events.forEach(e -> types.add(e.get("type").asText()));
    assertThat(types)
        .containsExactlyInAnyOrder("CREATED", "PEOPLE_ADDED", "PEOPLE_ADDED", "PEOPLE_REMOVED");
    assertThat(texts(events)).contains(nameOf(p3) + " 님을 추가했습니다", nameOf(p1) + " 님을 제외했습니다");

    List<AuditLogRecord> changes = audits(rootId, "WIKI_SHARE_PEOPLE_CHANGED");
    assertThat(changes).hasSize(2);
    JsonNode last = metadata(changes.get(0));
    assertThat(longs(last.get("added"))).containsExactly(p3);
    assertThat(longs(last.get("removed"))).containsExactly(p1);
    assertThat(last.get("viaRequest").asBoolean()).isFalse();
    assertThat(last.get("audience").asText()).isEqualTo("PEOPLE");
    assertThat(last.get("spaceId").asLong()).isEqualTo(spaceId);
    JsonNode first = metadata(changes.get(1));
    assertThat(longs(first.get("added"))).containsExactlyInAnyOrder(p1, p2);
    assertThat(first.get("removed")).isEmpty();

    // 워크스페이스 구성원이 아닌 사용자는 지정할 수 없다(다른 테넌트 사용자의 이름이 응답에 실리지 않게).
    long outsider = TestFixtures.createHuman(dsl);
    call(save(rootId, "PEOPLE", "VIEW", false, List.of(p2, outsider), null), ownerId)
        .andExpect(status().isBadRequest());
  }

  /** 재발급하면 토큰이 바뀌고 이전 토큰은 그 즉시 404 — 새 토큰은 열린다. 기록 REGENERATED·감사 WIKI_SHARE_REGENERATED. */
  @Test
  void regenerate_changes_token_and_old_token_404() throws Exception {
    String old =
        json(call(save(rootId, "WORKSPACE", "VIEW", false, List.of(), null), ownerId)
                .andExpect(status().isOk()))
            .get("token")
            .asText();
    callWithShare(get("/api/v1/wiki/pages/{id}", rootId), strangerId, old)
        .andExpect(status().isOk());

    JsonNode res =
        json(call(post(sharePath(rootId) + "/regenerate"), ownerId).andExpect(status().isOk()));
    String fresh = res.get("token").asText();
    assertThat(fresh).startsWith("wsh_").isNotEqualTo(old);
    assertThat(res.get("audience").asText()).isEqualTo("WORKSPACE");

    callWithShare(get("/api/v1/wiki/pages/{id}", rootId), strangerId, old)
        .andExpect(status().isNotFound());
    callWithShare(get("/api/v1/wiki/pages/{id}", rootId), strangerId, fresh)
        .andExpect(status().isOk());

    assertThat(events(rootId).get(0).get("type").asText()).isEqualTo("REGENERATED");
    assertThat(audits(rootId, "WIKI_SHARE_REGENERATED")).hasSize(1);
    // 공유가 없는 페이지의 재발급은 404.
    call(post(sharePath(childId) + "/regenerate"), ownerId).andExpect(status().isNotFound());
  }

  /** 해제하면 공유 행과 토큰은 사라지지만 기록은 남는다(REVOKED 가 맨 위). 감사 reason=USER. */
  @Test
  void revoke_deletes_share_keeps_events() throws Exception {
    String token =
        json(call(save(rootId, "WORKSPACE", "EDIT", true, List.of(), null), ownerId)
                .andExpect(status().isOk()))
            .get("token")
            .asText();

    call(delete(sharePath(rootId)), ownerId).andExpect(status().isNoContent());

    assertThat(shareCount(rootId)).isZero();
    call(get(sharePath(rootId)), ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.share").isEmpty());
    callWithShare(get("/api/v1/wiki/pages/{id}", rootId), strangerId, token)
        .andExpect(status().isNotFound());

    JsonNode events = events(rootId);
    assertThat(events).hasSize(2);
    assertThat(events.get(0).get("type").asText()).isEqualTo("REVOKED");
    assertThat(events.get(0).get("detail").asText()).isEqualTo("공유를 해제했습니다");
    assertThat(events.get(1).get("type").asText()).isEqualTo("CREATED");

    JsonNode meta = metadata(audits(rootId, "WIKI_SHARE_REVOKED").get(0));
    assertThat(meta.get("reason").asText()).isEqualTo("USER");
    assertThat(meta.get("audience").asText()).isEqualTo("WORKSPACE");
    assertThat(meta.get("permission").asText()).isEqualTo("EDIT");

    // 이미 해제된 공유를 다시 해제해도 204(멱등) — 기록은 더 생기지 않는다.
    call(delete(sharePath(rootId)), ownerId).andExpect(status().isNoContent());
    assertThat(events(rootId)).hasSize(2);
  }

  /**
   * 접근을 줄이는 변경(워크스페이스 → 지정한 사람, 사람 제외, 만료 정함, 편집 → 보기, 하위 포함 끔, 재발급, 해제)은 동작마다 {@link
   * WikiShareAccessChangedEvent} 를 정확히 1건 발행한다 — pageIds 는 바뀌기 전 공유가 덮던 페이지(하위 포함이었으면 서브트리 전체). 넓히는
   * 변경(편집 허용·사람 추가)과 처음 만들기는 발행하지 않는다. 건수는 발행 시점에 동기로 센다(시계 없음). 커밋 뒤 리스너가 동기화 서버까지 닿는지는 끝에서 한 번만
   * 기다려 확인한다.
   */
  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void narrowing_publishes_access_changed_event() throws Exception {
    List<Long> subtree = List.of(rootId, childId, grandchildId);
    OffsetDateTime in7 = OffsetDateTime.now().plusDays(7);

    call(save(rootId, "WORKSPACE", "VIEW", true, List.of(), null), ownerId)
        .andExpect(status().isOk());
    expectNoAccessChange();
    call(save(rootId, "WORKSPACE", "EDIT", true, List.of(), null), ownerId)
        .andExpect(status().isOk());
    expectNoAccessChange();

    call(save(rootId, "PEOPLE", "EDIT", true, List.of(p1, p2), null), ownerId)
        .andExpect(status().isOk());
    expectAccessChange(subtree);
    call(save(rootId, "PEOPLE", "EDIT", true, List.of(p1, p2, p3), null), ownerId)
        .andExpect(status().isOk());
    expectNoAccessChange();
    call(save(rootId, "PEOPLE", "EDIT", true, List.of(p1, p3), null), ownerId)
        .andExpect(status().isOk());
    expectAccessChange(subtree);
    call(save(rootId, "PEOPLE", "EDIT", true, List.of(p1, p3), in7), ownerId)
        .andExpect(status().isOk());
    expectAccessChange(subtree);
    call(save(rootId, "PEOPLE", "VIEW", true, List.of(p1, p3), in7), ownerId)
        .andExpect(status().isOk());
    expectAccessChange(subtree);
    // 하위 포함을 끄면 이제 안 보이는 하위 페이지까지 — 바뀌기 전 범위(서브트리)로.
    call(save(rootId, "PEOPLE", "VIEW", false, List.of(p1, p3), in7), ownerId)
        .andExpect(status().isOk());
    expectAccessChange(subtree);

    // 하위 미포함 공유는 그 페이지 하나만.
    call(post(sharePath(rootId) + "/regenerate"), ownerId).andExpect(status().isOk());
    expectAccessChange(List.of(rootId));
    call(delete(sharePath(rootId)), ownerId).andExpect(status().isNoContent());
    expectAccessChange(List.of(rootId));

    // 커밋 뒤 리스너가 동기화 서버 재검증으로 이어진다(공유 재검증은 스페이스·사용자 없이 pageIds 만, 사유 없음).
    verify(collab, timeout(2000).atLeastOnce())
        .revalidate(
            argThat(
                (RevalidateRequest r) ->
                    r.tenantId() == 1L
                        && r.spaceId() == null
                        && r.userId() == null
                        && r.reason() == null
                        && r.pageIds() != null
                        && Set.copyOf(r.pageIds()).equals(Set.copyOf(subtree))));
  }

  /**
   * 강등과 공유 저장의 경합 — 소유자가 편집자를 보기로 내리는 트랜잭션이 아직 커밋 전일 때 그 편집자가 공유를 저장하면, 저장은 호출자 멤버 행 잠금(FOR
   * SHARE)에서 강등 커밋을 기다렸다가 바뀐 역할(보기)로 판정돼 403 이 된다. 잠그지 않으면 옛 역할(편집)로 통과해, 강등이 정리하지 못한 「강등된 사람 이름의
   * 공유」가 남는다. 순서는 시간 단언 없이 잠금 대기 관측(RowLockWaits)으로 맞춘다.
   */
  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void save_waits_for_concurrent_demotion_and_is_forbidden() throws Exception {
    long editorId = human();
    TenantContext.set(1L);
    spaceService.addMember(ownerId, spaceId, editorId, "EDITOR");

    CountDownLatch demoted = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<?> demotion =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                new TransactionTemplate(txManager)
                    .executeWithoutResult(
                        tx -> {
                          spaceService.changeRole(ownerId, spaceId, editorId, "VIEWER");
                          demoted.countDown();
                          RowLockWaits.awaitQuietly(release); // 커밋을 붙잡아 둔다
                        });
                TenantContext.clear();
              });
      RowLockWaits.awaitQuietly(demoted);

      Future<Integer> saving =
          pool.submit(
              () -> {
                int status =
                    call(save(rootId, "WORKSPACE", "EDIT", true, List.of(), null), editorId)
                        .andReturn()
                        .getResponse()
                        .getStatus();
                TenantContext.clear();
                return status;
              });
      RowLockWaits.awaitLockWaiter(saving); // 강등이 쥔 멤버 행에서 기다리는 중
      release.countDown();
      demotion.get(10, TimeUnit.SECONDS);

      assertThat(saving.get(10, TimeUnit.SECONDS)).isEqualTo(403);
      assertThat(shareCount(rootId)).isZero();
    } finally {
      release.countDown();
      pool.shutdownNow();
      TenantContext.set(1L);
    }
  }

  /**
   * 강등과 접근 요청 거절의 경합 — 승인과 같은 잠금 경로(lockEditor)라, 편집자를 보기로 내리는 트랜잭션이 커밋 전이면 그 편집자의 거절은 멤버 행 잠금에서 강등
   * 커밋을 기다렸다가 바뀐 역할(보기)로 403 이 된다. 잠그지 않으면 옛 역할로 통과해 강등된 사람이 요청을 결정한다. 순서는 잠금 대기 관측으로 맞춘다.
   */
  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void deny_waits_for_concurrent_demotion_and_is_forbidden() throws Exception {
    long editorId = human();
    TenantContext.set(1L);
    spaceService.addMember(ownerId, spaceId, editorId, "EDITOR");
    call(save(rootId, "PEOPLE", "VIEW", false, List.of(p1), null), ownerId)
        .andExpect(status().isOk());
    // 대기 요청은 직접 넣는다 — 요청 API 는 커밋 뒤 알림 리스너를 돌려 정리와 경합한다.
    long reqId =
        inTenant(
            () ->
                dsl.insertInto(WIKI_SHARE_ACCESS_REQUEST)
                    .set(WIKI_SHARE_ACCESS_REQUEST.PAGE_ID, rootId)
                    .set(WIKI_SHARE_ACCESS_REQUEST.REQUESTER_ID, strangerId)
                    .returning(WIKI_SHARE_ACCESS_REQUEST.ID)
                    .fetchOne()
                    .getId());

    CountDownLatch demoted = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<?> demotion =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                new TransactionTemplate(txManager)
                    .executeWithoutResult(
                        tx -> {
                          spaceService.changeRole(ownerId, spaceId, editorId, "VIEWER");
                          demoted.countDown();
                          RowLockWaits.awaitQuietly(release); // 커밋을 붙잡아 둔다
                        });
                TenantContext.clear();
              });
      RowLockWaits.awaitQuietly(demoted);

      Future<Integer> denying =
          pool.submit(
              () -> {
                int status =
                    call(post(sharePath(rootId) + "/access-requests/" + reqId + "/deny"), editorId)
                        .andReturn()
                        .getResponse()
                        .getStatus();
                TenantContext.clear();
                return status;
              });
      RowLockWaits.awaitLockWaiter(denying); // 강등이 쥔 멤버 행에서 기다리는 중
      release.countDown();
      demotion.get(10, TimeUnit.SECONDS);

      assertThat(denying.get(10, TimeUnit.SECONDS)).isEqualTo(403);
      assertThat(
              inTenant(
                  () ->
                      dsl.select(WIKI_SHARE_ACCESS_REQUEST.STATUS)
                          .from(WIKI_SHARE_ACCESS_REQUEST)
                          .where(WIKI_SHARE_ACCESS_REQUEST.ID.eq(reqId))
                          .fetchOne(WIKI_SHARE_ACCESS_REQUEST.STATUS)))
          .isEqualTo("PENDING");
    } finally {
      release.countDown();
      pool.shutdownNow();
      TenantContext.set(1L);
    }
  }

  /**
   * 해제→재공유와 접근 요청의 경합 — 소유자가 지정한 사람 공유를 해제하고 같은 페이지에 새로 공유하는 트랜잭션이 아직 커밋 전일 때 옛 링크로 접근을 요청하면, 요청은
   * 공유 행 잠금에서 그 커밋을 기다렸다가 옛 공유가 사라진 것을 보고 닫힌 링크(404)가 된다. 잠그지 않으면 옛 공유를 보고 대기 요청을 만들어, 해제가 이미 대기
   * 요청을 지운 뒤라 그 요청이 새 공유 밑에 고아로 남는다(그 거절은 재요청 대기에도 잡히지 않는다). 순서는 잠금 대기 관측(RowLockWaits)으로 맞춘다.
   */
  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void access_request_waits_for_concurrent_reshare_and_sees_closed_link() throws Exception {
    String oldToken =
        json(call(save(rootId, "PEOPLE", "VIEW", false, List.of(p1), null), ownerId)
                .andExpect(status().isOk()))
            .get("token")
            .asText();

    CountDownLatch reshared = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<?> reshare =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                new TransactionTemplate(txManager)
                    .executeWithoutResult(
                        tx -> {
                          shareService.revoke(ownerId, rootId);
                          shareService.save(
                              ownerId,
                              rootId,
                              new WikiPageShareRequest(
                                  "PEOPLE", "VIEW", false, List.of(p1), null, null));
                          reshared.countDown();
                          RowLockWaits.awaitQuietly(release); // 커밋을 붙잡아 둔다
                        });
                TenantContext.clear();
              });
      RowLockWaits.awaitQuietly(reshared);

      Future<Integer> requesting =
          pool.submit(
              () -> {
                int status =
                    call(post("/api/v1/wiki/shares/{t}/access-requests", oldToken), strangerId)
                        .andReturn()
                        .getResponse()
                        .getStatus();
                TenantContext.clear();
                return status;
              });
      RowLockWaits.awaitLockWaiter(requesting); // 재공유가 쥔 옛 공유 행에서 기다리는 중
      release.countDown();
      reshare.get(10, TimeUnit.SECONDS);

      assertThat(requesting.get(10, TimeUnit.SECONDS)).isEqualTo(404);
      assertThat(
              inTenant(
                  () ->
                      dsl.fetchCount(
                          WIKI_SHARE_ACCESS_REQUEST, WIKI_SHARE_ACCESS_REQUEST.PAGE_ID.eq(rootId))))
          .isZero();
      // 새 공유는 그대로 — 다른 토큰으로 열려 있다.
      assertThat(inTenant(() -> shareCount(rootId))).isEqualTo(1);
    } finally {
      release.countDown();
      pool.shutdownNow();
      TenantContext.set(1L);
    }
  }

  /** 상위 페이지의 하위 포함 공유로 이미 보이는 페이지는 가장 가까운 그 상위를 알려 준다(하위 미포함·만료된 공유는 건너뛴다). */
  @Test
  void inherited_from_reports_nearest_including_ancestor() throws Exception {
    call(save(rootId, "PUBLIC", "VIEW", true, List.of(), null), ownerId).andExpect(status().isOk());
    call(save(childId, "WORKSPACE", "VIEW", true, List.of(), null), ownerId)
        .andExpect(status().isOk());

    call(get(sharePath(grandchildId)), ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.share").isEmpty())
        .andExpect(jsonPath("$.inheritedFrom.pageId").value(childId))
        .andExpect(jsonPath("$.inheritedFrom.title").value("1분기"))
        .andExpect(jsonPath("$.inheritedFrom.audience").value("WORKSPACE"));
    // 자기 공유는 상속으로 치지 않는다 — 1분기는 루트에서 상속.
    call(get(sharePath(childId)), ownerId)
        .andExpect(jsonPath("$.share.audience").value("WORKSPACE"))
        .andExpect(jsonPath("$.inheritedFrom.pageId").value(rootId))
        .andExpect(jsonPath("$.inheritedFrom.audience").value("PUBLIC"));
    call(get(sharePath(rootId)), ownerId).andExpect(jsonPath("$.inheritedFrom").isEmpty());

    // 가까운 상위가 하위 미포함이 되면 그 위로.
    call(save(childId, "WORKSPACE", "VIEW", false, List.of(), null), ownerId)
        .andExpect(status().isOk());
    call(get(sharePath(grandchildId)), ownerId)
        .andExpect(jsonPath("$.inheritedFrom.pageId").value(rootId))
        .andExpect(jsonPath("$.inheritedFrom.title").value("제품 로드맵"));

    // 만료된 상위 공유는 보이지 않는다 — 만료 판정은 DB now() 와 비교하므로 같은 DB 시계로 당긴다(컨테이너 시계 어긋남 대비).
    dsl.update(WIKI_PAGE_SHARE)
        .set(
            WIKI_PAGE_SHARE.EXPIRES_AT,
            DSL.field("now() - interval '1 minute'", OffsetDateTime.class))
        .where(WIKI_PAGE_SHARE.PAGE_ID.eq(rootId))
        .execute();
    call(get(sharePath(grandchildId)), ownerId).andExpect(jsonPath("$.inheritedFrom").isEmpty());
  }

  /** 대상·권한이 빠진 저장 요청은 400(기존 문구) — null 이 불변 Set 의 contains 에서 NPE(500)로 새지 않는다. */
  @Test
  void save_without_audience_or_permission_is_400() throws Exception {
    call(save(rootId, null, "VIEW", false, List.of(), null), ownerId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("열 수 있는 사람이 올바르지 않습니다"));
    call(save(rootId, "WORKSPACE", null, false, List.of(), null), ownerId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("권한이 올바르지 않습니다"));
    assertThat(shareCount(rootId)).isZero();
  }

  /** 알림 메시지는 채팅 메시지와 같은 4000자까지 — 넘으면 400 이고 공유는 만들어지지 않는다. */
  @Test
  void notify_message_over_limit_is_400() throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("audience", "PEOPLE");
    body.put("permission", "VIEW");
    body.put("includeChildren", false);
    body.put("userIds", List.of(p1));
    body.put("notify", Map.of("message", "가".repeat(4001)));
    call(
            put(sharePath(rootId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(body)),
            ownerId)
        .andExpect(status().isBadRequest());
    assertThat(shareCount(rootId)).isZero();

    body.put("notify", Map.of("message", "가".repeat(4000)));
    call(
            put(sharePath(rootId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(body)),
            ownerId)
        .andExpect(status().isOk());
  }

  // ── 도우미 ─────────────────────────────────────────────────────────────

  /** 방금 동작이 공유 접근 변경 이벤트를 정확히 1건, 이 페이지들로 발행했는지. 확인한 뒤 기록을 비운다. */
  private void expectAccessChange(List<Long> pageIds) {
    List<WikiShareAccessChangedEvent> published =
        appEvents.stream(WikiShareAccessChangedEvent.class).toList();
    assertThat(published).hasSize(1);
    WikiShareAccessChangedEvent e = published.get(0);
    assertThat(e.tenantId()).isEqualTo(1L);
    assertThat(e.pageIds()).containsExactlyInAnyOrderElementsOf(pageIds);
    appEvents.clear();
  }

  /** 방금 동작이 공유 접근 변경 이벤트를 발행하지 않았는지. */
  private void expectNoAccessChange() {
    assertThat(appEvents.stream(WikiShareAccessChangedEvent.class)).isEmpty();
    appEvents.clear();
  }

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    seededUserIds.add(id);
    return id;
  }

  private long page(Long parentId, String title) {
    TenantContext.set(1L);
    long id = pageService.create(ownerId, spaceId, new CreatePageRequest(parentId, title)).id();
    TenantContext.set(1L);
    return id;
  }

  private static String sharePath(long pageId) {
    return "/api/v1/wiki/pages/" + pageId + "/share";
  }

  private MockHttpServletRequestBuilder save(
      long pageId,
      String audience,
      String permission,
      boolean includeChildren,
      List<Long> userIds,
      OffsetDateTime expiresAt)
      throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("audience", audience);
    body.put("permission", permission);
    body.put("includeChildren", includeChildren);
    body.put("userIds", userIds);
    body.put("expiresAt", expiresAt == null ? null : expiresAt.toString());
    body.put("notify", Map.of());
    return put(sharePath(pageId))
        .contentType(MediaType.APPLICATION_JSON)
        .content(om.writeValueAsString(body));
  }

  /** 사용자 JWT(테넌트 1)로 요청한다. */
  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    return callWithShare(req, userId, null);
  }

  private ResultActions callWithShare(
      MockHttpServletRequestBuilder req, long userId, String shareToken) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    if (shareToken != null) {
      req.header(WikiShareAccess.HEADER, shareToken);
    }
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }

  private JsonNode events(long pageId) throws Exception {
    return json(call(get(sharePath(pageId) + "/events"), ownerId).andExpect(status().isOk()));
  }

  private static List<String> texts(JsonNode events) {
    List<String> out = new ArrayList<>();
    events.forEach(e -> out.add(e.get("detail").asText()));
    return out;
  }

  private static List<Long> longs(JsonNode array) {
    List<Long> out = new ArrayList<>();
    array.forEach(n -> out.add(n.asLong()));
    return out;
  }

  /** 이 페이지의 감사 로그(최신순). */
  private List<AuditLogRecord> audits(long pageId, String actionType) {
    return inTenant(
        () ->
            dsl.selectFrom(AUDIT_LOG)
                .where(AUDIT_LOG.ACTION_TYPE.eq(actionType))
                .and(AUDIT_LOG.RESOURCE.eq("wiki"))
                .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(pageId)))
                .orderBy(AUDIT_LOG.ID.desc())
                .fetch());
  }

  private JsonNode metadata(AuditLogRecord r) throws Exception {
    assertThat(r.getMetadata()).as("감사 metadata 가 직렬화돼 남아야 한다").isNotNull();
    return om.readTree(r.getMetadata().data());
  }

  private int shareCount(long pageId) {
    return inTenant(() -> dsl.fetchCount(WIKI_PAGE_SHARE, WIKI_PAGE_SHARE.PAGE_ID.eq(pageId)));
  }

  private String nameOf(long userId) {
    return dsl.select(USER.NAME).from(USER).where(USER.ID.eq(userId)).fetchOne(USER.NAME);
  }

  /** 테스트 트랜잭션 안이면 그대로, 밖(커밋 테스트)이면 테넌트 1 트랜잭션에서 읽는다 — RLS 가 GUC 없이 행을 가리지 않게. */
  private <T> T inTenant(Supplier<T> read) {
    if (TestTransaction.isActive()) {
      return read.get();
    }
    TenantContext.set(1L);
    return new TransactionTemplate(txManager).execute(s -> read.get());
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
  }
}
