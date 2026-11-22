package com.workplace.contacts;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.CONTACT_ENTRY;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.contacts.dto.ExternalContactDetail;
import com.workplace.contacts.dto.UpdateExternalContactRequest;
import com.workplace.contacts.exception.ContactDuplicateWarningException;
import com.workplace.contacts.exception.ContactNotFoundException;
import com.workplace.contacts.service.ContactService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.RowLockWaits;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 외부 연락처 동시 수정(WP-1951) — 수정은 현재 행을 읽어 요청 필드와 병합해 전체를 다시 쓰므로, 행을 잠그지 않으면 겹친 두 요청이 같은 옛 값을 읽어 앞 요청의
 * 변경을 조용히 덮었다. 수정이 행을 잠가 직렬화하므로 나중 요청은 앞 요청 커밋을 기다렸다가 최신 행 위에서 병합·중복 판정한다.
 *
 * <p>먼저 요청을 트랜잭션을 연 채(커밋 전) 멈춰 두고 나중 요청을 보내 결정적으로 만든다({@link ContactDeleteRefsRaceTest} 와 같은 방식).
 */
class ContactUpdateRaceTest extends IntegrationTestBase {

  @Autowired ContactService contactService;

  private final List<Long> users = new ArrayList<>();
  private long owner;
  private long contactId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = user("o");
    contactId = insertContact("단일-1", null);
    baseDsl
        .update(CONTACT_ENTRY)
        .set(CONTACT_ENTRY.PHONE, "010-0000-1111")
        .set(CONTACT_ENTRY.TITLE, "원본직책")
        .set(CONTACT_ENTRY.NOTES, "원본메모")
        .set(CONTACT_ENTRY.ORGANIZATION, "조직원본")
        .where(CONTACT_ENTRY.ID.eq(contactId))
        .execute();
  }

  @AfterEach
  void cleanup() {
    baseDsl.deleteFrom(CONTACT_ENTRY).where(CONTACT_ENTRY.OWNER_ID.in(users)).execute();
    baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    TenantContext.clear();
  }

  private long insertContact(String name, String email) {
    return baseDsl
        .insertInto(CONTACT_ENTRY)
        .set(CONTACT_ENTRY.NAME, name)
        .set(CONTACT_ENTRY.EMAIL, email)
        .set(CONTACT_ENTRY.OWNER_ID, owner)
        .set(CONTACT_ENTRY.VISIBILITY, "SHARED")
        .set(CONTACT_ENTRY.TENANT_ID, 1L)
        .returning(CONTACT_ENTRY.ID)
        .fetchOne()
        .getId();
  }

  private long user(String prefix) {
    String s = UUID.randomUUID().toString().substring(0, 8);
    long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    TestFixtures.addMember(baseDsl, id, 1L);
    users.add(id);
    return id;
  }

  /** 지정한 필드만 채운 부분 수정 요청(나머지는 생략=유지). */
  private static UpdateExternalContactRequest req(
      String name, String email, String phone, String title, String notes) {
    return new UpdateExternalContactRequest(name, email, phone, null, title, notes, null);
  }

  @Test
  void update_concurrentDifferentFields_bothSurvive() throws Exception {
    Object r =
        RowLockWaits.race(
            txManager,
            1L,
            () ->
                contactService.update(
                    owner, contactId, req(null, null, "010-7777-7777", null, null), false),
            () ->
                contactService.update(
                    owner, contactId, req(null, null, null, "동시직책", null), false));
    assertThat(r).isInstanceOf(ExternalContactDetail.class);
    ExternalContactDetail d = contactService.getExternal(owner, contactId);
    assertThat(d.phone()).isEqualTo("010-7777-7777");
    assertThat(d.title()).isEqualTo("동시직책");
    assertThat(d.notes()).isEqualTo("원본메모");
  }

  @Test
  void update_concurrentSameField_laterWins() throws Exception {
    Object r =
        RowLockWaits.race(
            txManager,
            1L,
            () -> contactService.update(owner, contactId, req(null, null, null, null, "A"), false),
            () -> contactService.update(owner, contactId, req(null, null, null, null, "B"), false));
    assertThat(r).isInstanceOf(ExternalContactDetail.class);
    assertThat(contactService.getExternal(owner, contactId).notes()).isEqualTo("B");
  }

  @Test
  void update_waitsAndJudgesDuplicateOnLatestRow() throws Exception {
    insertContact("중복이름", "dup@example.com");
    Object r =
        RowLockWaits.race(
            txManager,
            1L,
            () ->
                contactService.update(
                    owner, contactId, req("중복이름", "dup@example.com", null, null, null), true),
            () ->
                contactService.update(
                    owner, contactId, req(null, null, "010-8888-8888", null, null), false));
    assertThat(r).isInstanceOf(ContactDuplicateWarningException.class);
  }

  @Test
  void update_afterConcurrentDelete_throwsNotFound() throws Exception {
    Object r =
        RowLockWaits.race(
            txManager,
            1L,
            () -> contactService.delete(owner, contactId),
            () ->
                contactService.update(
                    owner, contactId, req(null, null, "010-9999-9999", null, null), false));
    assertThat(r).isInstanceOf(ContactNotFoundException.class);
    assertThat(baseDsl.fetchCount(CONTACT_ENTRY, CONTACT_ENTRY.ID.eq(contactId))).isZero();
  }

  @Test
  void delete_waitsForConcurrentUpdateAndDeletesRow() throws Exception {
    // PERSONAL 로 시작해 update 가 SHARED 로 바꾼 뒤 커밋 — delete 는 잠금 대기 뒤 커밋된 값 위에서 권한 판정·알림 범위를 정한다.
    baseDsl
        .update(CONTACT_ENTRY)
        .set(CONTACT_ENTRY.VISIBILITY, "PERSONAL")
        .where(CONTACT_ENTRY.ID.eq(contactId))
        .execute();
    Object r =
        RowLockWaits.race(
            txManager,
            1L,
            () ->
                contactService.update(
                    owner,
                    contactId,
                    new UpdateExternalContactRequest(null, null, null, null, null, null, "SHARED"),
                    false),
            () -> {
              contactService.delete(owner, contactId);
              return "deleted";
            });
    assertThat(r).isEqualTo("deleted");
    assertThat(baseDsl.fetchCount(CONTACT_ENTRY, CONTACT_ENTRY.ID.eq(contactId))).isZero();
  }

  @Test
  void update_byNonOwner_doesNotWaitForOwnerLock() throws Exception {
    long stranger = user("s");
    baseDsl
        .update(CONTACT_ENTRY)
        .set(CONTACT_ENTRY.VISIBILITY, "PERSONAL")
        .where(CONTACT_ENTRY.ID.eq(contactId))
        .execute();
    // 소유자가 행 잠금을 쥔 채 커밋 전에 멈춘 동안, 쓰기 권한 없는 호출자는 잠금을 기다리지 않고 즉시 404(PERSONAL 존재 은닉)로 끝난다.
    Object r =
        RowLockWaits.whileHolding(
            txManager,
            1L,
            () ->
                contactService.update(
                    owner, contactId, req(null, null, "010-1212-1212", null, null), false),
            () ->
                contactService.update(
                    stranger, contactId, req(null, null, "010-3434-3434", null, null), false));
    assertThat(r).isInstanceOf(ContactNotFoundException.class);
  }
}
