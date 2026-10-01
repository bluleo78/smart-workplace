package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
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

  /** 정규화해 주소다운 값(@ 포함)만 담는다. */
  private static void addAddress(Set<String> out, String address) {
    String n = MailAddresses.normalize(address);
    if (n != null && n.contains("@")) {
      out.add(n);
    }
  }
}
