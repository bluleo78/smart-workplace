package com.workplace.wiki;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE_EVENT;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static com.workplace.jooq.Tables.WIKI_SPACE_MEMBER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.jooq.tables.records.AuditLogRecord;
import com.workplace.jooq.tables.records.WikiPageShareEventRecord;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.outbound.AgentDeleted;
import com.workplace.user.service.UserService;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiShareAccessChangedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiSpaceMembershipChangedEvent;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiShareAudit;
import com.workplace.wiki.service.WikiSpaceService;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
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
 * 노트 공유의 생애(WP-579 Task 6) — 페이지 이동(하위 포함 공유 안·밖), 공유한 사람의 편집 권한 상실·워크스페이스 정지, 페이지·스페이스 삭제 때 공유가
 * 어떻게 정리되고 무엇이 남는지.
 *
 * <p>공유·이동·역할 변경·삭제는 실제 API(MockMvc)로 해 행위자가 요청 사용자로 잡히게 한다 — 공유 기록과 감사 로그의 행위자가 같은 사람인지 본다.
 * {@code @Transactional}: 요청이 테스트 트랜잭션에 합류해 끝나면 롤백된다. 정지는 커밋 직전 리스너가 일하므로 그 테스트만 테스트 트랜잭션을 커밋하고
 * {@link #cleanupCommitted} 가 시드를 지운다.
 */
@Transactional
@RecordApplicationEvents
class WikiShareLifecycleTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired UserService userService;
  @Autowired ApplicationEvents appEvents;

  private long ownerId; // 두 스페이스의 OWNER
  private long editorId; // 두 스페이스의 EDITOR — 공유한 사람
  private long spaceId;
  private long otherSpaceId;
  private long rootId; // 스페이스1 최상위
  private long childId; // rootId 아래
  private long grandchildId; // childId 아래
  private long outsideId; // 스페이스1 최상위(공유 없음)
  private long otherPageId; // 스페이스2 최상위

  /** 정지 테스트처럼 테스트 트랜잭션을 커밋했으면 true — 끝나고 시드한 스페이스를 지운다. */
  private boolean committed;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    committed = false;
    ownerId = human();
    editorId = human();
    spaceId = spaceService.createTeamSpace(ownerId, "공유생애-" + UUID.randomUUID()).id();
    otherSpaceId = spaceService.createTeamSpace(ownerId, "공유생애2-" + UUID.randomUUID()).id();
    spaceService.addMember(ownerId, spaceId, editorId, "EDITOR");
    spaceService.addMember(ownerId, otherSpaceId, editorId, "EDITOR");
    rootId = page(spaceId, null, "제품 로드맵");
    childId = page(spaceId, rootId, "1분기 계획");
    grandchildId = page(spaceId, childId, "1분기 세부");
    outsideId = page(spaceId, null, "회의록");
    otherPageId = page(otherSpaceId, null, "다른 스페이스 문서");
    appEvents.clear();
  }

  /** 커밋한 시드를 지운다 — 스페이스를 지우면 페이지·멤버·공유·공유 기록이 CASCADE 로 함께 지워진다(사용자 행은 남겨도 다른 테스트와 겹치지 않는다). */
  @AfterEach
  void cleanupCommitted() {
    if (!committed) {
      return;
    }
    cleanupSpaces(spaceId, otherSpaceId);
  }

  /** 커밋한 시드 스페이스를 테넌트 1 에서 지운다. */
  private void cleanupSpaces(Long... ids) {
    cleanupInTenant(
        1L, () -> dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.ID.in(List.of(ids))).execute());
  }

  // ── 이동 ────────────────────────────────────────────────────────────────

  /**
   * 하위 포함 공유 루트 밖으로 옮기면 그 공유의 기록에 PAGE_MOVED_OUT(옮긴 사람·옮긴 페이지 제목), 옮긴 서브트리 전체로 재검증 이벤트 — 공유로 열려 있던
   * 화면이 닫히게.
   */
  @Test
  void move_out_of_included_share_records_and_revalidates() throws Exception {
    saveShare(editorId, rootId, "WORKSPACE", "EDIT", true);
    appEvents.clear();

    move(ownerId, childId, outsideId);

    List<WikiPageShareEventRecord> out = events(rootId, "PAGE_MOVED_OUT");
    assertThat(out).hasSize(1);
    assertThat(out.get(0).getActorId()).isEqualTo(ownerId);
    assertThat(text(out.get(0))).contains("1분기 계획");
    assertThat(om.readTree(out.get(0).getDetail().data()).get("title").asText())
        .isEqualTo("1분기 계획");
    assertThat(events(rootId, "PAGE_MOVED_IN")).isEmpty();

    List<WikiShareAccessChangedEvent> changed = accessChanged();
    assertThat(changed).hasSize(1);
    assertThat(changed.get(0).pageIds()).containsExactlyInAnyOrder(childId, grandchildId);
    // 공유 자체는 그대로다 — 루트는 움직이지 않았다.
    assertThat(shareCount(rootId)).isEqualTo(1);
  }

  /** 하위 포함 공유 루트 안으로 옮기면 PAGE_MOVED_IN — 열 수 있는 범위가 넓어질 뿐이라 재검증은 없다. */
  @Test
  void move_into_share_records_moved_in() throws Exception {
    saveShare(editorId, rootId, "WORKSPACE", "VIEW", true);
    appEvents.clear();

    move(ownerId, outsideId, childId);

    List<WikiPageShareEventRecord> in = events(rootId, "PAGE_MOVED_IN");
    assertThat(in).hasSize(1);
    assertThat(in.get(0).getActorId()).isEqualTo(ownerId);
    assertThat(text(in.get(0))).contains("회의록");
    assertThat(events(rootId, "PAGE_MOVED_OUT")).isEmpty();
    assertThat(accessChanged()).isEmpty();
  }

  /**
   * 공유 루트 자신을 옮기면 그 공유는 함께 옮겨 간다 — 공유 행이 그대로이고 그 공유의 기록에는 이동이 남지 않는다. 옮긴 페이지를 덮던 상위 하위 포함 공유에서는
   * 빠지므로 그쪽에만 PAGE_MOVED_OUT, 재검증 대상은 옮긴 서브트리.
   */
  @Test
  void move_shared_root_keeps_share() throws Exception {
    saveShare(editorId, rootId, "WORKSPACE", "VIEW", true);
    saveShare(editorId, childId, "WORKSPACE", "VIEW", true);
    appEvents.clear();

    move(ownerId, childId, outsideId);

    assertThat(shareCount(childId)).isEqualTo(1);
    assertThat(events(childId, "PAGE_MOVED_OUT")).isEmpty();
    assertThat(events(childId, "PAGE_MOVED_IN")).isEmpty();
    List<WikiPageShareEventRecord> out = events(rootId, "PAGE_MOVED_OUT");
    assertThat(out).hasSize(1);
    assertThat(text(out.get(0))).contains("1분기 계획");
    List<WikiShareAccessChangedEvent> changed = accessChanged();
    assertThat(changed).hasSize(1);
    assertThat(changed.get(0).pageIds()).containsExactlyInAnyOrder(childId, grandchildId);
  }

  // ── 공유한 사람이 떠날 때 ──────────────────────────────────────────────────

  /**
   * 공유한 사람이 한 스페이스에서 보기로 강등되면 그 스페이스에서 그 사람이 만든 공유만 해제된다 — 다른 스페이스의 그 사람 공유, 같은 스페이스의 다른 사람 공유는
   * 남는다. 기록 REVOKED_BY_MEMBERSHIP·감사 reason MEMBERSHIP 의 행위자는 강등한 OWNER 로 같고, 재검증 이벤트는 해제한 공유가 덮던
   * 페이지로 한 번.
   */
  @Test
  void demoted_sharer_loses_shares_in_that_space_only() throws Exception {
    saveShare(editorId, rootId, "WORKSPACE", "EDIT", true);
    saveShare(editorId, outsideId, "PUBLIC", "VIEW", false);
    saveShare(editorId, otherPageId, "WORKSPACE", "VIEW", false);
    saveShare(ownerId, childId, "WORKSPACE", "VIEW", false);
    appEvents.clear();

    call(patchJson(memberPath(spaceId, editorId), Map.of("role", "VIEWER")), ownerId)
        .andExpect(status().isNoContent());

    assertThat(shareCount(rootId)).isZero();
    assertThat(shareCount(outsideId)).isZero();
    assertThat(shareCount(otherPageId)).isEqualTo(1);
    assertThat(shareCount(childId)).isEqualTo(1);

    List<WikiPageShareEventRecord> revoked = events(rootId, "REVOKED_BY_MEMBERSHIP");
    assertThat(revoked).hasSize(1);
    assertThat(revoked.get(0).getActorId()).isEqualTo(ownerId);
    AuditLogRecord audit = single(audits(rootId));
    assertThat(audit.getUserId()).isEqualTo(ownerId);
    JsonNode meta = metadata(audit);
    assertThat(meta.get("reason").asText()).isEqualTo("MEMBERSHIP");
    assertThat(meta.get("spaceId").asLong()).isEqualTo(spaceId);
    assertThat(meta.get("audience").asText()).isEqualTo("WORKSPACE");
    assertThat(meta.get("permission").asText()).isEqualTo("EDIT");
    assertThat(metadata(single(audits(outsideId))).get("reason").asText()).isEqualTo("MEMBERSHIP");
    assertThat(audits(otherPageId)).isEmpty();

    List<WikiShareAccessChangedEvent> changed = accessChanged();
    assertThat(changed).hasSize(1);
    assertThat(changed.get(0).pageIds())
        .containsExactlyInAnyOrder(rootId, childId, grandchildId, outsideId);
  }

  /** 스페이스에서 내보내져도 같다 — 그 스페이스의 공유만 해제. 편집 권한을 그대로 두는 역할 변경(EDITOR→OWNER)은 아무것도 지우지 않는다. */
  @Test
  void removed_sharer_loses_shares_in_that_space() throws Exception {
    saveShare(editorId, rootId, "WORKSPACE", "VIEW", false);
    saveShare(editorId, otherPageId, "WORKSPACE", "VIEW", false);

    call(patchJson(memberPath(otherSpaceId, editorId), Map.of("role", "OWNER")), ownerId)
        .andExpect(status().isNoContent());
    assertThat(shareCount(otherPageId)).isEqualTo(1);

    call(delete(memberPath(spaceId, editorId)), ownerId).andExpect(status().isNoContent());

    assertThat(shareCount(rootId)).isZero();
    assertThat(shareCount(otherPageId)).isEqualTo(1);
    assertThat(events(rootId, "REVOKED_BY_MEMBERSHIP")).hasSize(1);
    assertThat(metadata(single(audits(rootId))).get("reason").asText()).isEqualTo("MEMBERSHIP");
  }

  /**
   * 워크스페이스에서 정지되면 그 사람이 만든 공유가 모든 스페이스에서 해제된다(정지 커밋 직전, 같은 트랜잭션). 정지를 일으킨 요청 사용자가 없으면 기록·감사 행위자는 둘
   * 다 시스템. 재검증 이벤트는 두 스페이스의 해제한 공유가 덮던 페이지를 모아 한 번.
   */
  @Test
  void suspended_sharer_loses_all_shares() throws Exception {
    saveShare(editorId, rootId, "WORKSPACE", "EDIT", true);
    saveShare(editorId, otherPageId, "PEOPLE", "VIEW", false, List.of(ownerId));
    saveShare(ownerId, outsideId, "WORKSPACE", "VIEW", false);
    appEvents.clear();

    userService.setUserActive(editorId, false, null);
    // 정지 리스너는 커밋 직전에 돈다 — 테스트 트랜잭션을 커밋해 실제 경로를 태운다.
    committed = true;
    TestTransaction.flagForCommit();
    TestTransaction.end();
    TenantContext.set(1L);

    assertThat(shareCount(rootId)).isZero();
    assertThat(shareCount(otherPageId)).isZero();
    assertThat(shareCount(outsideId)).isEqualTo(1);

    List<WikiPageShareEventRecord> revoked = events(rootId, "REVOKED_BY_MEMBERSHIP");
    assertThat(revoked).hasSize(1);
    assertThat(revoked.get(0).getActorId()).isNull();
    assertThat(events(otherPageId, "REVOKED_BY_MEMBERSHIP")).hasSize(1);
    AuditLogRecord audit = single(audits(rootId));
    assertThat(audit.getUserId()).isNull();
    assertThat(audit.getUsername()).isEqualTo("system");
    assertThat(metadata(audit).get("reason").asText()).isEqualTo("MEMBERSHIP");
    assertThat(metadata(single(audits(otherPageId))).get("reason").asText())
        .isEqualTo("MEMBERSHIP");

    List<WikiShareAccessChangedEvent> changed = accessChanged();
    assertThat(changed).hasSize(1);
    assertThat(changed.get(0).tenantId()).isEqualTo(1L);
    assertThat(changed.get(0).pageIds())
        .containsExactlyInAnyOrder(rootId, childId, grandchildId, otherPageId);
  }

  /**
   * AGENT 를 지우면(하드 삭제 — 공유 FK 는 CASCADE) 그 에이전트가 만든 공유가 조용히 사라지지 않고 정상 해제 경로로 해제된다 — 지우기 전에 같은
   * 트랜잭션에서 기록(「에이전트가 삭제되어」)·감사 (reason MEMBERSHIP)·재검증 이벤트가 남고, 삭제는 성공한다. 지정 대상이었던 사람이 열어 둔 연결은 사용자
   * 단위 재검증 이벤트(AgentDeleted)로 닫힌다.
   *
   * <p>에이전트는 실제처럼 스페이스 멤버가 되어 설정 API 로 공유를 만든다 — 그래서 스페이스 멤버 행과 자기가 행위자인 감사 행(공유 생성)이 남는다. 멤버 행은 FK
   * CASCADE 가 아니라 멤버 제거 경로로 지워져(멤버 변경 이벤트가 스페이스마다 나간다) 삭제를 막지 않고, 감사 행은 V196 으로 user_id 만 비워 남아
   * username 으로 누가 했는지 읽힌다.
   */
  @Test
  void deleted_agent_shares_are_revoked_through_normal_path() throws Exception {
    long agentId = withMembership(TestFixtures.createAgentNoToken(dsl));
    spaceService.addMember(ownerId, spaceId, agentId, "EDITOR");
    spaceService.addMember(ownerId, otherSpaceId, agentId, "VIEWER");
    saveShare(agentId, rootId, "WORKSPACE", "EDIT", true);
    AuditLogRecord created = single(audits(rootId, WikiShareAudit.CREATED));
    assertThat(created.getUserId()).isEqualTo(agentId);
    String agentUsername = created.getUsername();
    appEvents.clear();

    userService.deleteAgent(ownerId, agentId);

    assertThat(shareCount(rootId)).isZero();
    List<WikiPageShareEventRecord> revokedEvents = events(rootId, "REVOKED_BY_MEMBERSHIP");
    assertThat(revokedEvents).hasSize(1);
    assertThat(text(revokedEvents.get(0))).contains("에이전트가 삭제되어");
    AuditLogRecord revoked = single(audits(rootId));
    assertThat(metadata(revoked).get("reason").asText()).isEqualTo("MEMBERSHIP");
    assertThat(accessChanged())
        .singleElement()
        .satisfies(
            e -> assertThat(e.pageIds()).containsExactlyInAnyOrder(rootId, childId, grandchildId));
    assertThat(appEvents.stream(AgentDeleted.class).toList())
        .containsExactly(new AgentDeleted(1L, agentId, ownerId));
    // 에이전트가 남긴 감사 행은 지워지지 않고 행위자 id 만 비고 이름은 남는다.
    AuditLogRecord createdAfter = single(audits(rootId, WikiShareAudit.CREATED));
    assertThat(createdAfter.getId()).isEqualTo(created.getId());
    assertThat(createdAfter.getUserId()).isNull();
    assertThat(createdAfter.getUsername()).isEqualTo(agentUsername);
    // 두 팀 스페이스의 멤버 행은 멤버 제거 경로로 지워진다 — 스페이스마다 멤버 변경 이벤트(열린 연결 재검증)가 나간다.
    assertThat(memberCount(agentId)).isZero();
    assertThat(
            appEvents.stream(WikiSpaceMembershipChangedEvent.class)
                .filter(e -> e.userId() == agentId)
                .map(WikiSpaceMembershipChangedEvent::spaceId)
                .toList())
        .containsExactlyInAnyOrder(spaceId, otherSpaceId);
  }

  /**
   * 지우려는 AGENT 가 팀 스페이스의 유일한 OWNER 면 멤버 제거와 같은 마지막 OWNER 보호(WP-496)로 409 가 되고, 삭제 전체가 롤백된다 — 먼저 한
   * 공유 해제도 되돌아가 공유·멤버십·사용자 행이 그대로다. FK CASCADE 로 멤버 행을 지우면 관리자 없는 스페이스가 조용히 남는다.
   *
   * <p>롤백을 실제로 보려고 테스트 트랜잭션 밖에서 돈다(시드는 커밋되고 {@link #cleanupCommitted} 가 지운다). 스페이스는 사람이 만들고(소유
   * owner_id 는 사람) 에이전트를 OWNER 로 넣은 뒤 사람을 내려, 다른 FK 가 아니라 마지막 OWNER 보호에 막히게 한다.
   */
  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void deleting_last_owner_agent_is_rejected_and_rolled_back() throws Exception {
    committed = true;
    long admin = admin();
    long agentId = withMembership(TestFixtures.createAgentNoToken(dsl));
    for (long space : List.of(spaceId, otherSpaceId)) {
      spaceService.addMember(ownerId, space, agentId, "OWNER");
      spaceService.changeRole(agentId, space, ownerId, "EDITOR");
    }
    saveShare(agentId, rootId, "WORKSPACE", "VIEW", false);

    // 관리자는 에이전트 화면에 있으므로, 유일한 소유자인 노트 공간을 이름으로 한 번에 모두 알린다(WP-785).
    deleteAgentAsAdmin(admin, agentId)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(startsWith("이 AI 에이전트가 「공유생애")))
        .andExpect(jsonPath("$.message").value(containsString("「공유생애-")))
        .andExpect(jsonPath("$.message").value(containsString("「공유생애2-")))
        .andExpect(jsonPath("$.message").value(containsString("노트 공간의 유일한 소유자라 삭제할 수 없습니다")));

    assertThat(inTenant(() -> shareCount(rootId))).isEqualTo(1);
    assertThat(inTenant(() -> events(rootId, "REVOKED_BY_MEMBERSHIP"))).isEmpty();
    // 두 공간의 멤버십이 모두 그대로다.
    assertThat(inTenant(() -> memberCount(agentId))).isEqualTo(2);
    assertThat(inTenant(() -> dsl.fetchExists(USER, USER.ID.eq(agentId)))).isTrue();
  }

  /**
   * 작업 기록(작성자·소유자 NOT NULL FK)이 남은 AGENT 는 완전히 지울 수 없어 사용 중지로 대신한다(WP-705) — 삭제 시도는 savepoint 째
   * 되돌아가 먼저 한 공유 해제·멤버 제거도 남지 않고, 공유는 정지 경로가 다시 해제한다(기록 문구가 「정지되어」). 작업 기록으로는 노트 목록을 열 때 생기는 개인 노트
   * 공간(wiki_space.owner_id)을 쓴다 — 실제로 일한 에이전트가 가장 흔히 갖는 것이고, 개인 스페이스를 멤버 제거 대상에서 빼는 것도 함께 본다.
   */
  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void deleting_agent_with_work_records_falls_back_to_deactivation() throws Exception {
    committed = true;
    long admin = admin();
    long agentId = withMembership(TestFixtures.createAgentNoToken(dsl));
    spaceService.addMember(ownerId, spaceId, agentId, "EDITOR");
    saveShare(agentId, rootId, "WORKSPACE", "VIEW", false);
    long personalSpaceId = spaceService.ensurePersonalSpace(agentId).id();
    TenantContext.set(1L);

    try {
      deleteAgentAsAdmin(admin, agentId)
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.result").value("DEACTIVATED"));

      assertThat(inTenant(() -> shareCount(rootId))).isZero();
      List<WikiPageShareEventRecord> revokedEvents =
          inTenant(() -> events(rootId, "REVOKED_BY_MEMBERSHIP"));
      assertThat(revokedEvents).hasSize(1);
      assertThat(text(revokedEvents.get(0))).contains("정지되어");
      // 팀 스페이스 멤버 행(제거됐다가 롤백)과 개인 스페이스 OWNER 행이 모두 남는다.
      assertThat(inTenant(() -> memberCount(agentId))).isEqualTo(2);
      assertThat(inTenant(() -> dsl.fetchExists(USER, USER.ID.eq(agentId)))).isTrue();
    } finally {
      // 에이전트 개인 노트 공간은 시드가 아니라 이 테스트가 만든 것 — 여기서 지운다.
      cleanupSpaces(personalSpaceId);
    }
  }

  // ── 삭제 ────────────────────────────────────────────────────────────────

  /**
   * 페이지를 지우면 함께 사라지는 공유(자기·하위 페이지의 공유)마다 감사 WIKI_SHARE_REVOKED(reason PAGE_DELETED, 행위자 = 지운 사람)가
   * 남는다. 지운 서브트리 밖의 공유는 그대로.
   */
  @Test
  void page_delete_audits_revoke() throws Exception {
    saveShare(editorId, rootId, "WORKSPACE", "VIEW", true);
    saveShare(editorId, grandchildId, "PUBLIC", "VIEW", false);
    saveShare(editorId, outsideId, "WORKSPACE", "VIEW", false);

    call(delete("/api/v1/wiki/pages/{id}", rootId), ownerId).andExpect(status().isNoContent());

    assertThat(shareCount(rootId)).isZero();
    assertThat(shareCount(grandchildId)).isZero();
    assertThat(shareCount(outsideId)).isEqualTo(1);
    AuditLogRecord rootAudit = single(audits(rootId));
    assertThat(rootAudit.getUserId()).isEqualTo(ownerId);
    JsonNode meta = metadata(rootAudit);
    assertThat(meta.get("reason").asText()).isEqualTo("PAGE_DELETED");
    assertThat(meta.get("spaceId").asLong()).isEqualTo(spaceId);
    assertThat(meta.get("audience").asText()).isEqualTo("WORKSPACE");
    JsonNode publicMeta = metadata(single(audits(grandchildId)));
    assertThat(publicMeta.get("reason").asText()).isEqualTo("PAGE_DELETED");
    assertThat(publicMeta.get("audience").asText()).isEqualTo("PUBLIC");
    assertThat(audits(outsideId)).isEmpty();
  }

  /** 팀 스페이스를 지워도 그 스페이스의 공유마다 같은 감사가 남는다. 다른 스페이스의 공유는 그대로. */
  @Test
  void space_delete_audits_revoke() throws Exception {
    saveShare(editorId, childId, "WORKSPACE", "VIEW", false);
    saveShare(editorId, otherPageId, "WORKSPACE", "VIEW", false);

    call(delete("/api/v1/wiki/spaces/{id}", spaceId), ownerId).andExpect(status().isNoContent());

    assertThat(shareCount(childId)).isZero();
    assertThat(shareCount(otherPageId)).isEqualTo(1);
    AuditLogRecord audit = single(audits(childId));
    assertThat(audit.getUserId()).isEqualTo(ownerId);
    assertThat(metadata(audit).get("reason").asText()).isEqualTo("PAGE_DELETED");
    assertThat(audits(otherPageId)).isEmpty();
  }

  // ── 도우미 ─────────────────────────────────────────────────────────────

  /** 테넌트#1 ACTIVE 멤버인 사람 사용자. */
  private long human() {
    return withMembership(TestFixtures.createHuman(dsl));
  }

  /** 워크스페이스 ADMIN — AI 관리 API 는 권한 코드와 함께 ADMIN 역할도 본다(WP-729). */
  private long admin() {
    long id = human();
    TestFixtures.grantRole(dsl, id, "ADMIN");
    return id;
  }

  private long page(long inSpaceId, Long parentId, String title) {
    TenantContext.set(1L);
    long id = pageService.create(ownerId, inSpaceId, new CreatePageRequest(parentId, title)).id();
    TenantContext.set(1L);
    return id;
  }

  private void move(long userId, long pageId, Long parentId) throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("parentId", parentId);
    body.put("position", 0);
    call(patchJson("/api/v1/wiki/pages/" + pageId + "/move", body), userId)
        .andExpect(status().isNoContent());
  }

  private static String memberPath(long space, long userId) {
    return "/api/v1/wiki/spaces/" + space + "/members/" + userId;
  }

  private void saveShare(
      long userId, long pageId, String audience, String permission, boolean includeChildren)
      throws Exception {
    saveShare(userId, pageId, audience, permission, includeChildren, List.of());
  }

  /** 설정 API 로 공유를 만든다 — 기록·감사가 실제 경로로 남는다. */
  private void saveShare(
      long userId,
      long pageId,
      String audience,
      String permission,
      boolean includeChildren,
      List<Long> userIds)
      throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("audience", audience);
    body.put("permission", permission);
    body.put("includeChildren", includeChildren);
    body.put("userIds", userIds);
    body.put("expiresAt", null);
    body.put("notify", Map.of());
    call(
            put("/api/v1/wiki/pages/" + pageId + "/share")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(body)),
            userId)
        .andExpect(status().isOk());
  }

  private MockHttpServletRequestBuilder patchJson(String path, Object body) throws Exception {
    return patch(path).contentType(MediaType.APPLICATION_JSON).content(om.writeValueAsString(body));
  }

  /** 사용자 JWT(테넌트 1)로 요청한다. */
  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    return perform(req);
  }

  /** 요청을 보내고 테넌트 컨텍스트를 1 로 되돌린다(요청 처리가 비우므로 이어지는 단언이 RLS 에 가리지 않게). */
  private ResultActions perform(MockHttpServletRequestBuilder req) throws Exception {
    TenantContext.set(1L);
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }

  /** 관리자(user:write)로 AGENT 삭제 API 를 부른다 — 응답 상태·문구까지 실제 경로로 본다. */
  private ResultActions deleteAgentAsAdmin(long adminId, long agentId) throws Exception {
    return perform(
        delete("/api/v1/admin/agents/{id}", agentId)
            .with(
                authentication(
                    new UsernamePasswordAuthenticationToken(
                        adminId, "n/a", List.of(new SimpleGrantedAuthority("user:write"))))));
  }

  /** 테스트 트랜잭션 안이면 그대로, 밖(커밋 테스트)이면 테넌트 1 트랜잭션에서 읽는다 — RLS 가 GUC 없이 행을 가리지 않게. */
  private <T> T inTenant(Supplier<T> read) {
    if (TestTransaction.isActive()) {
      return read.get();
    }
    TenantContext.set(1L);
    return new TransactionTemplate(txManager).execute(s -> read.get());
  }

  /** 이 사람의 노트 스페이스 멤버 행 수(개인·팀 모두). */
  private int memberCount(long userId) {
    return dsl.fetchCount(WIKI_SPACE_MEMBER, WIKI_SPACE_MEMBER.USER_ID.eq(userId));
  }

  private int shareCount(long pageId) {
    return dsl.fetchCount(WIKI_PAGE_SHARE, WIKI_PAGE_SHARE.PAGE_ID.eq(pageId));
  }

  /** 이 페이지의 공유 기록 중 그 종류(오래된 순). */
  private List<WikiPageShareEventRecord> events(long pageId, String type) {
    return dsl.selectFrom(WIKI_PAGE_SHARE_EVENT)
        .where(WIKI_PAGE_SHARE_EVENT.PAGE_ID.eq(pageId))
        .and(WIKI_PAGE_SHARE_EVENT.TYPE.eq(type))
        .orderBy(WIKI_PAGE_SHARE_EVENT.ID.asc())
        .fetch();
  }

  private String text(WikiPageShareEventRecord r) throws Exception {
    return om.readTree(r.getDetail().data()).get("text").asText();
  }

  /** 이 페이지의 공유 해제 감사 로그. */
  private List<AuditLogRecord> audits(long pageId) {
    return audits(pageId, WikiShareAudit.REVOKED);
  }

  /** 이 페이지의 그 종류 공유 감사 로그(최근 순). */
  private List<AuditLogRecord> audits(long pageId, String actionType) {
    return dsl.selectFrom(AUDIT_LOG)
        .where(AUDIT_LOG.ACTION_TYPE.eq(actionType))
        .and(AUDIT_LOG.RESOURCE.eq("wiki"))
        .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(pageId)))
        .orderBy(AUDIT_LOG.ID.desc())
        .fetch();
  }

  private static AuditLogRecord single(List<AuditLogRecord> rows) {
    assertThat(rows).hasSize(1);
    return rows.get(0);
  }

  private JsonNode metadata(AuditLogRecord r) throws Exception {
    assertThat(r.getMetadata()).as("감사 metadata 가 직렬화돼 남아야 한다").isNotNull();
    return om.readTree(r.getMetadata().data());
  }

  private List<WikiShareAccessChangedEvent> accessChanged() {
    return new ArrayList<>(appEvents.stream(WikiShareAccessChangedEvent.class).toList());
  }
}
