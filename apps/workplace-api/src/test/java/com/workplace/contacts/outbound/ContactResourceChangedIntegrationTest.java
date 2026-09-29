package com.workplace.contacts.outbound;

import static com.workplace.jooq.Tables.CONTACT_ENTRY;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.clearInvocations;

import com.workplace.contacts.dto.ExternalContactRequest;
import com.workplace.contacts.dto.FavoriteRequest;
import com.workplace.contacts.dto.UpdateExternalContactRequest;
import com.workplace.contacts.service.ContactService;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.ResourceChangedCapture;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** WP-64 통합 — 연락처·즐겨찾기 변경 → AFTER_COMMIT resource.changed 수신자 검증(커밋 필요, @Transactional 없음). */
@DisplayName("연락처 변경 → resource.changed fan-out 통합")
class ContactResourceChangedIntegrationTest extends IntegrationTestBase {

  @MockitoBean SseRegistry registry;

  @Autowired DSLContext dsl;
  @Autowired ContactService service;

  private final List<Long> userIds = new ArrayList<>();
  private Long owner;
  private Long colleague;
  private Long otherTenantUser;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = user("owner", true);
    colleague = user("colleague", true);
    otherTenantUser = user("other", false);
    long t2 =
        baseDsl
            .insertInto(TENANT)
            .set(TENANT.NAME, "rc-t2")
            .set(TENANT.SLUG, "rc-t2-" + UUID.randomUUID().toString().substring(0, 8))
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();
    baseDsl
        .insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, otherTenantUser)
        .set(MEMBERSHIP.TENANT_ID, t2)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
  }

  @AfterEach
  void cleanup() {
    dsl.deleteFrom(CONTACT_ENTRY).where(CONTACT_ENTRY.OWNER_ID.in(userIds)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute();
    // tenant 는 앱 롤에 DELETE 권한이 없다 — 격리 DB 라 남겨 두고, membership 은 user FK CASCADE 로 정리된다.
    userIds.clear();
    TenantContext.clear();
  }

  private Long user(String prefix, boolean tenant1) {
    String s = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    userIds.add(id);
    if (tenant1) withMembership(id);
    return id;
  }

  private ExternalContactRequest req(String visibility) {
    return new ExternalContactRequest(
        "rc-" + UUID.randomUUID(), null, null, null, null, null, visibility);
  }

  private Collection<Long> capture(String op) {
    return ResourceChangedCapture.capture(registry, "contact", op).recipients();
  }

  @Test
  @DisplayName("SHARED 연락처 생성은 같은 테넌트 구성원에게, 다른 테넌트는 제외")
  void sharedContactCreate_reachesTenantMember() {
    clearInvocations(registry);
    service.create(owner, req("SHARED"), true);
    assertThat(capture("created")).contains(owner, colleague).doesNotContain(otherTenantUser);
  }

  @Test
  @DisplayName("PERSONAL 연락처 생성은 소유자에게만")
  void personalContactCreate_ownerOnly() {
    clearInvocations(registry);
    service.create(owner, req("PERSONAL"), true);
    assertThat(capture("created")).containsExactly(owner);
  }

  @Test
  @DisplayName("SHARED→PERSONAL 수정은 이전에 보이던 테넌트 전체에게")
  void sharedToPersonalUpdate_reachesTenant() {
    long id = service.create(owner, req("SHARED"), true).id();
    clearInvocations(registry);
    service.update(
        owner,
        id,
        new UpdateExternalContactRequest(null, null, null, null, null, null, "PERSONAL"),
        true);
    assertThat(capture("updated")).contains(owner, colleague);
  }

  @Test
  @DisplayName("즐겨찾기 추가는 호출자에게만")
  void favoriteAdd_callerOnly() {
    long id = service.create(owner, req("SHARED"), true).id();
    clearInvocations(registry);
    service.addFavorite(colleague, new FavoriteRequest("EXTERNAL", id));
    assertThat(capture("updated")).containsExactly(colleague);
  }
}
