package com.workplace.contacts;

import static com.workplace.jooq.Tables.CONTACT_ENTRY;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.contacts.dto.ContactPage;
import com.workplace.contacts.dto.ContactSummary;
import com.workplace.contacts.exception.ContactNotFoundException;
import com.workplace.contacts.service.ContactService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 커서 페이지 조립 및 상세 격리. 메서드 롤백 격리. */
@Transactional
class ContactServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired ContactService service;

  private long seedExternal(String name, long owner) {
    return dsl.insertInto(CONTACT_ENTRY)
        .set(CONTACT_ENTRY.NAME, name)
        .set(CONTACT_ENTRY.OWNER_ID, owner)
        .set(CONTACT_ENTRY.VISIBILITY, "PERSONAL")
        .returning(CONTACT_ENTRY.ID)
        .fetchOne()
        .getId();
  }

  private long caller() {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "c_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Caller " + t)
        .set(USER.EMAIL, t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void list_paginatesWithCursor_acrossPersonalScope() {
    long c = caller();
    // 격리된 PERSONAL 외부만 보이도록 caller 본인 소유로 3건(이름 정렬: zc0<zc1<zc2)
    String base = "zc" + UUID.randomUUID().toString().substring(0, 4);
    seedExternal(base + "_2", c);
    seedExternal(base + "_0", c);
    seedExternal(base + "_1", c);

    ContactPage p1 = service.list(c, base, "EXTERNAL", null, 2);
    assertThat(p1.items()).hasSize(2);
    assertThat(p1.hasMore()).isTrue();
    assertThat(p1.nextCursor()).isNotNull();
    assertThat(p1.items())
        .extracting(ContactSummary::name)
        .containsExactly(base + "_0", base + "_1");

    ContactPage p2 = service.list(c, base, "EXTERNAL", p1.nextCursor(), 2);
    assertThat(p2.items()).extracting(ContactSummary::name).containsExactly(base + "_2");
    assertThat(p2.hasMore()).isFalse();
    assertThat(p2.nextCursor()).isNull();
  }

  @Test
  void getMember_missing_throwsNotFound() {
    assertThatThrownBy(() -> service.getMember(99_999_999L))
        .isInstanceOf(ContactNotFoundException.class);
  }

  @Test
  void getExternal_personalOther_throwsNotFound() {
    long owner = caller();
    long other = caller();
    long id = seedExternal("priv" + UUID.randomUUID().toString().substring(0, 4), owner);
    assertThatThrownBy(() -> service.getExternal(other, id))
        .isInstanceOf(ContactNotFoundException.class);
  }

  // === Task A5 추가 ===

  // visibility 지정 외부 시드
  private long seedExternal(String name, long owner, String visibility) {
    return dsl.insertInto(CONTACT_ENTRY)
        .set(CONTACT_ENTRY.NAME, name)
        .set(CONTACT_ENTRY.OWNER_ID, owner)
        .set(CONTACT_ENTRY.VISIBILITY, visibility)
        .returning(CONTACT_ENTRY.ID)
        .fetchOne()
        .getId();
  }

  // 사용자에 ADMIN 역할 부여
  private void makeAdmin(long userId) {
    Long roleId =
        dsl.select(com.workplace.jooq.Tables.ROLE.ID)
            .from(com.workplace.jooq.Tables.ROLE)
            .where(com.workplace.jooq.Tables.ROLE.NAME.eq("ADMIN"))
            .fetchOne(com.workplace.jooq.Tables.ROLE.ID);
    dsl.insertInto(com.workplace.jooq.Tables.USER_ROLE)
        .set(com.workplace.jooq.Tables.USER_ROLE.USER_ID, userId)
        .set(com.workplace.jooq.Tables.USER_ROLE.ROLE_ID, roleId)
        .execute();
  }

  @Test
  void create_setsOwnerToCaller_andNormalizesBlanks() {
    long c = caller();
    var detail =
        service.create(
            c,
            new com.workplace.contacts.dto.ExternalContactRequest(
                "신규", "", "010", "", "", "", "PERSONAL"));
    assertThat(detail.name()).isEqualTo("신규");
    assertThat(detail.email()).isNull(); // 빈문자열→null
    assertThat(detail.phone()).isEqualTo("010");
    assertThat(detail.editable()).isTrue();
  }

  @Test
  void update_byOwner_replacesFields() {
    long c = caller();
    long id = seedExternal("old", c, "PERSONAL");
    var d =
        service.update(
            c,
            id,
            new com.workplace.contacts.dto.ExternalContactRequest(
                "new", null, null, null, null, null, "SHARED"));
    assertThat(d.name()).isEqualTo("new");
    assertThat(d.visibility()).isEqualTo("SHARED");
  }

  @Test
  void update_personalByNonOwner_throwsNotFound() {
    long owner = caller();
    long other = caller();
    long id = seedExternal("priv", owner, "PERSONAL");
    assertThatThrownBy(
            () ->
                service.update(
                    other,
                    id,
                    new com.workplace.contacts.dto.ExternalContactRequest(
                        "x", null, null, null, null, null, "PERSONAL")))
        .isInstanceOf(ContactNotFoundException.class);
  }

  @Test
  void update_sharedByNonOwner_throwsForbidden() {
    long owner = caller();
    long other = caller();
    long id = seedExternal("shared", owner, "SHARED");
    assertThatThrownBy(
            () ->
                service.update(
                    other,
                    id,
                    new com.workplace.contacts.dto.ExternalContactRequest(
                        "x", null, null, null, null, null, "SHARED")))
        .isInstanceOf(com.workplace.contacts.exception.ContactForbiddenException.class);
  }

  @Test
  void update_byAdmin_overridesOwnership() {
    long owner = caller();
    long admin = caller();
    makeAdmin(admin);
    long id = seedExternal("shared", owner, "SHARED");
    var d =
        service.update(
            admin,
            id,
            new com.workplace.contacts.dto.ExternalContactRequest(
                "byadmin", null, null, null, null, null, "SHARED"));
    assertThat(d.name()).isEqualTo("byadmin");
  }

  @Test
  void delete_byOwner_removesAndSubsequentGetIs404() {
    long c = caller();
    long id = seedExternal("tmp", c, "PERSONAL");
    service.delete(c, id);
    assertThatThrownBy(() -> service.getExternal(c, id))
        .isInstanceOf(ContactNotFoundException.class);
  }

  @Test
  void delete_sharedByNonOwner_throwsForbidden() {
    long owner = caller();
    long other = caller();
    long id = seedExternal("shared", owner, "SHARED");
    assertThatThrownBy(() -> service.delete(other, id))
        .isInstanceOf(com.workplace.contacts.exception.ContactForbiddenException.class);
  }

  @Test
  void getExternal_sharedByNonOwner_editableFalse() {
    long owner = caller();
    long other = caller();
    long id = seedExternal("shared", owner, "SHARED");
    assertThat(service.getExternal(other, id).editable()).isFalse();
  }

  @Test
  void delete_personalByNonOwner_throwsNotFound() {
    long owner = caller();
    long other = caller();
    long id = seedExternal("priv", owner, "PERSONAL");
    assertThatThrownBy(() -> service.delete(other, id))
        .isInstanceOf(ContactNotFoundException.class);
  }

  @Test
  void delete_byAdmin_overridesOwnership() {
    long owner = caller();
    long admin = caller();
    makeAdmin(admin);
    long id = seedExternal("shared", owner, "SHARED");
    service.delete(admin, id);
    // admin 삭제 성공 → 행이 사라져 owner 조회도 404
    assertThatThrownBy(() -> service.getExternal(owner, id))
        .isInstanceOf(ContactNotFoundException.class);
  }

  @Test
  void update_nonexistentId_throwsNotFound() {
    long c = caller();
    assertThatThrownBy(
            () ->
                service.update(
                    c,
                    99_999_999L,
                    new com.workplace.contacts.dto.ExternalContactRequest(
                        "x", null, null, null, null, null, "PERSONAL")))
        .isInstanceOf(ContactNotFoundException.class);
  }

  @Test
  void delete_nonexistentId_throwsNotFound() {
    long c = caller();
    assertThatThrownBy(() -> service.delete(c, 99_999_999L))
        .isInstanceOf(ContactNotFoundException.class);
  }

  @Test
  void getExternal_personalByAdmin_returnsRow_editableTrue() {
    long owner = caller();
    long admin = caller();
    makeAdmin(admin);
    long id = seedExternal("priv", owner, "PERSONAL");
    // ADMIN 은 타인 PERSONAL 도 조회 가능, editable=true
    var d = service.getExternal(admin, id);
    assertThat(d.name()).isEqualTo("priv");
    assertThat(d.editable()).isTrue();
  }

  @Test
  void update_personalByAdmin_succeeds() {
    long owner = caller();
    long admin = caller();
    makeAdmin(admin);
    long id = seedExternal("old", owner, "PERSONAL");
    var d =
        service.update(
            admin,
            id,
            new com.workplace.contacts.dto.ExternalContactRequest(
                "byadmin", null, null, null, null, null, "PERSONAL"));
    assertThat(d.name()).isEqualTo("byadmin");
  }
}
