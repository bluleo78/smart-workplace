package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.CONTACT_ENTRY;
import static com.workplace.jooq.Tables.CONTACT_FAVORITE;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;

import com.workplace.mail.util.MailAddresses;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record2;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 메일 개인 분석(WP-150)의 사람 정보 조회 — "나" 프로필(주소·이름·직함·소속)과 보낸 사람 관계(사내 구성원·외부 연락처·즐겨찾기).
 *
 * <p>user·membership 은 tenant_id/RLS 가 없는 전역 테이블이라 테넌트 조건을 직접 건다(#832).
 * email_account·user_group(_member)· contact_* 는 RLS(app.tenant_id GUC)로 현재 테넌트만 보인다 — 호출자는 테넌트
 * 트랜잭션 안에서 부른다. 다른 도메인 패키지(contacts·user)를 import 하지 않도록 jOOQ 테이블만 쓴다.
 */
@Repository
@RequiredArgsConstructor
public class MailPeopleRepository {

  private final DSLContext dsl;
  private final EmailMessageRepository messageRepo;

  /** 프로필 기본값 — user 의 이름·직함과 이 테넌트 내 계정들의 표시 이름(id 순, null 제외). */
  public record ProfileBasics(String name, String title, List<String> accountDisplayNames) {}

  /**
   * "나" 주소 — 이 테넌트의 내 메일 계정 주소(id 순, 비활성 계정 포함 — 여전히 내 주소다) 뒤에 user.email. {@link
   * MailAddresses#normalize}(trim+소문자)로 수신자 헤더와 같게 맞추고 중복을 뺀다. ④ 규칙·요청과 ⑤ 재계산이 모두 이 메서드만 쓴다(WP-150,
   * 계정으로 등록하지 않은 사용자 이메일로 받은 메일도 "나에게 온 메일"로 본다).
   */
  public List<String> listOwnAddresses(long userId) {
    Set<String> out = new LinkedHashSet<>();
    for (String a :
        dsl.select(EMAIL_ACCOUNT.EMAIL_ADDRESS)
            .from(EMAIL_ACCOUNT)
            .where(EMAIL_ACCOUNT.USER_ID.eq(userId))
            .orderBy(EMAIL_ACCOUNT.ID.asc())
            .fetch(EMAIL_ACCOUNT.EMAIL_ADDRESS)) {
      addAddress(out, a);
    }
    addAddress(
        out, dsl.select(USER.EMAIL).from(USER).where(USER.ID.eq(userId)).fetchOne(USER.EMAIL));
    return List.copyOf(out);
  }

  /** 이름·직함·계정 표시 이름. 사용자 행이 없으면 empty. */
  public Optional<ProfileBasics> findProfileBasics(long userId) {
    Record2<String, String> user =
        dsl.select(USER.NAME, USER.TITLE).from(USER).where(USER.ID.eq(userId)).fetchOne();
    if (user == null) {
      return Optional.empty();
    }
    List<String> displayNames =
        dsl.select(EMAIL_ACCOUNT.DISPLAY_NAME)
            .from(EMAIL_ACCOUNT)
            .where(EMAIL_ACCOUNT.USER_ID.eq(userId))
            .and(EMAIL_ACCOUNT.DISPLAY_NAME.isNotNull())
            .orderBy(EMAIL_ACCOUNT.ID.asc())
            .fetch(EMAIL_ACCOUNT.DISPLAY_NAME);
    return Optional.of(new ProfileBasics(user.value1(), user.value2(), displayNames));
  }

  /**
   * 소속 조직 — 공유(SHARED) 조직도에서 MEMBER 로 직접 속한 그룹 이름(정렬 순서 → 이름). 상위 그룹은 따라가지 않는다. 다른 사람의 PERSONAL 그룹에
   * 내가 들어 있어도 소속이 아니다(그 사람만의 분류).
   */
  public List<String> listSharedGroupNames(long userId) {
    return dsl.select(USER_GROUP.NAME)
        .from(USER_GROUP_MEMBER)
        .join(USER_GROUP)
        .on(USER_GROUP.ID.eq(USER_GROUP_MEMBER.GROUP_ID))
        .where(USER_GROUP_MEMBER.TARGET_TYPE.eq("MEMBER"))
        .and(USER_GROUP_MEMBER.TARGET_ID.eq(userId))
        .and(USER_GROUP.VISIBILITY.eq("SHARED"))
        .orderBy(USER_GROUP.SORT_ORDER.asc(), USER_GROUP.NAME.asc())
        .fetch(USER_GROUP.NAME);
  }

  /** 사내 구성원 일치 결과. */
  public record MemberMatch(long userId, String name, String title) {}

  /** 외부 연락처 일치 결과. */
  public record ContactMatch(long id, String name, String title, String organization) {}

  /**
   * 현재 테넌트 id — TenantContext(요청·비동기 전파) 우선, 없으면 커넥션 GUC. 둘 다 없으면 예외(관계 블록만 빠진다). user·membership 이
   * 전역 테이블이라 사내 구성원 판정에 테넌트를 직접 넘겨야 한다. 판정 로직은 {@link EmailMessageRepository#requireTenantId} 하나만
   * 둔다.
   */
  public long currentTenantId() {
    return messageRepo.requireTenantId();
  }

  /**
   * 주소(소문자)가 이 테넌트 활성 구성원(ACTIVE 멤버십 · HUMAN · is_active)의 user.email 또는 그 사람의 이 테넌트 메일 계정 주소와 일치하면
   * 그 사람(여럿이면 id 최소). 나 자신은 제외한다. 멤버십 조건은 ContactRepository.findPage 와 같다(#832 — 없으면 타 테넌트 사용자가
   * 보인다). 메일 도메인으로 추정하지 않는다.
   */
  public Optional<MemberMatch> findMemberByAddress(long tenantId, String address, long selfUserId) {
    var accountMatch =
        DSL.exists(
            DSL.selectOne()
                .from(EMAIL_ACCOUNT)
                .where(EMAIL_ACCOUNT.USER_ID.eq(USER.ID))
                .and(EMAIL_ACCOUNT.TENANT_ID.eq(tenantId))
                .and(DSL.lower(DSL.trim(EMAIL_ACCOUNT.EMAIL_ADDRESS)).eq(address)));
    return dsl.select(USER.ID, USER.NAME, USER.TITLE)
        .from(USER)
        .join(MEMBERSHIP)
        .on(MEMBERSHIP.USER_ID.eq(USER.ID))
        .where(MEMBERSHIP.TENANT_ID.eq(tenantId))
        .and(MEMBERSHIP.STATUS.eq("ACTIVE"))
        .and(USER.KIND.eq("HUMAN"))
        .and(USER.IS_ACTIVE.isTrue())
        .and(USER.ID.ne(selfUserId))
        .and(DSL.lower(DSL.trim(USER.EMAIL)).eq(address).or(accountMatch))
        .orderBy(USER.ID.asc())
        .limit(1)
        .fetchOptional(r -> new MemberMatch(r.value1(), r.value2(), r.value3()));
  }

  /** 두 사람이 함께 MEMBER 로 직접 속한 공유(SHARED) 그룹 이름 — "같은 조직". 개인 그룹·상위 그룹은 보지 않는다. */
  public List<String> listCommonSharedGroupNames(long userA, long userB) {
    var a = USER_GROUP_MEMBER.as("ma");
    var b = USER_GROUP_MEMBER.as("mb");
    return dsl.select(USER_GROUP.NAME)
        .from(USER_GROUP)
        .join(a)
        .on(a.GROUP_ID.eq(USER_GROUP.ID))
        .and(a.TARGET_TYPE.eq("MEMBER"))
        .and(a.TARGET_ID.eq(userA))
        .join(b)
        .on(b.GROUP_ID.eq(USER_GROUP.ID))
        .and(b.TARGET_TYPE.eq("MEMBER"))
        .and(b.TARGET_ID.eq(userB))
        .where(USER_GROUP.VISIBILITY.eq("SHARED"))
        .orderBy(USER_GROUP.SORT_ORDER.asc(), USER_GROUP.NAME.asc())
        .fetch(USER_GROUP.NAME);
  }

  /**
   * 내가 볼 수 있는 외부 연락처(SHARED 전체 + 내 PERSONAL — 타인 PERSONAL 제외, ContactRepository 목록과 같은 가시성) 중
   * 이메일(소문자)이 같은 것 1건. 내 연락처를 공유 연락처보다 먼저, 그다음 id 순.
   */
  public Optional<ContactMatch> findVisibleContactByEmail(long callerId, String address) {
    return dsl.select(
            CONTACT_ENTRY.ID, CONTACT_ENTRY.NAME, CONTACT_ENTRY.TITLE, CONTACT_ENTRY.ORGANIZATION)
        .from(CONTACT_ENTRY)
        .where(DSL.lower(DSL.trim(CONTACT_ENTRY.EMAIL)).eq(address))
        .and(CONTACT_ENTRY.VISIBILITY.eq("SHARED").or(CONTACT_ENTRY.OWNER_ID.eq(callerId)))
        .orderBy(
            DSL.when(CONTACT_ENTRY.OWNER_ID.eq(callerId), DSL.inline(0)).otherwise(DSL.inline(1)),
            CONTACT_ENTRY.ID.asc())
        .limit(1)
        .fetchOptional(r -> new ContactMatch(r.value1(), r.value2(), r.value3(), r.value4()));
  }

  /** 내 즐겨찾기 여부(targetType = MEMBER | EXTERNAL). */
  public boolean isFavorite(long ownerId, String targetType, long targetId) {
    return dsl.fetchExists(
        CONTACT_FAVORITE,
        CONTACT_FAVORITE.OWNER_ID.eq(ownerId),
        CONTACT_FAVORITE.TARGET_TYPE.eq(targetType),
        CONTACT_FAVORITE.TARGET_ID.eq(targetId));
  }

  /** 정규화해 주소다운 값(@ 포함)만 담는다. */
  private static void addAddress(Set<String> out, String address) {
    String n = MailAddresses.normalize(address);
    if (n != null && n.contains("@")) {
      out.add(n);
    }
  }
}
