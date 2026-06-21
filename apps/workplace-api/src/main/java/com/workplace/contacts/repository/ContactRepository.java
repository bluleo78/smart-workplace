package com.workplace.contacts.repository;

import static com.workplace.jooq.Tables.CONTACT_ENTRY;
import static com.workplace.jooq.Tables.CONTACT_FAVORITE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;

import com.workplace.contacts.dto.ContactFacets;
import com.workplace.contacts.dto.ContactSummary;
import com.workplace.contacts.dto.ExternalContactDetail;
import com.workplace.contacts.dto.ExternalContactRequest;
import com.workplace.contacts.dto.MemberDetail;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Table;
import org.jooq.impl.DSL;
import org.jooq.impl.SQLDataType;
import org.springframework.stereotype.Repository;

/**
 * 통합 연락처 조회. user(멤버, kind=HUMAN)와 contact_entry(외부)를 UNION ALL 파생테이블로 머지하고 (name, type, id) 키셋으로
 * 정렬·페이지네이션한다. 외부 PERSONAL 은 owner 만.
 */
@Repository
@RequiredArgsConstructor
public class ContactRepository {
  private final DSLContext dsl;

  /**
   * 통합 목록 1페이지. favorite=true 면 호출자가 즐겨찾기한 항목만. isFavorite 플래그는 callerId 기준 EXISTS 로 계산. limit 개 초과
   * 여부 판단은 service 가 limit+1 로 호출.
   *
   * @param callerId 호출자(외부 PERSONAL 격리 기준, isFavorite 계산 기준)
   * @param search null/blank 면 전체. name/email ILIKE
   * @param type ALL | MEMBER | EXTERNAL
   * @param favorite true 면 즐겨찾기 항목만
   * @param organization null/blank 면 무시. 외부 조직 정확 일치
   * @param title null/blank 면 무시. 직책 정확 일치
   * @param cursor 디코드된 커서(없으면 null). 이 값 다음(엄격히 큰) 행부터
   * @param limit 가져올 행 수
   */
  public List<ContactSummary> findPage(
      long callerId,
      String search,
      String type,
      boolean favorite,
      String organization,
      String title,
      ContactCursorCodec.Decoded cursor,
      int limit) {
    // 멤버 브랜치 — kind=HUMAN. is_favorite = (MEMBER, user.id) 즐겨찾기 존재 여부
    var members =
        dsl.select(
                DSL.inline("MEMBER").as("type"),
                USER.ID.as("id"),
                USER.NAME.as("name"),
                USER.EMAIL.as("email"),
                USER.TITLE.as("title"),
                DSL.castNull(SQLDataType.VARCHAR).as("organization"),
                DSL.field(
                        DSL.exists(
                            DSL.selectOne()
                                .from(CONTACT_FAVORITE)
                                .where(CONTACT_FAVORITE.OWNER_ID.eq(callerId))
                                .and(CONTACT_FAVORITE.TARGET_TYPE.eq("MEMBER"))
                                .and(CONTACT_FAVORITE.TARGET_ID.eq(USER.ID))))
                    .as("is_favorite"))
            .from(USER)
            .where(USER.KIND.eq("HUMAN"));

    // 외부 브랜치 — SHARED 전체 + 본인 PERSONAL. is_favorite = (EXTERNAL, contact_entry.id)
    var external =
        dsl.select(
                DSL.inline("EXTERNAL").as("type"),
                CONTACT_ENTRY.ID.as("id"),
                CONTACT_ENTRY.NAME.as("name"),
                CONTACT_ENTRY.EMAIL.as("email"),
                CONTACT_ENTRY.TITLE.as("title"),
                CONTACT_ENTRY.ORGANIZATION.as("organization"),
                DSL.field(
                        DSL.exists(
                            DSL.selectOne()
                                .from(CONTACT_FAVORITE)
                                .where(CONTACT_FAVORITE.OWNER_ID.eq(callerId))
                                .and(CONTACT_FAVORITE.TARGET_TYPE.eq("EXTERNAL"))
                                .and(CONTACT_FAVORITE.TARGET_ID.eq(CONTACT_ENTRY.ID))))
                    .as("is_favorite"))
            .from(CONTACT_ENTRY)
            .where(CONTACT_ENTRY.VISIBILITY.eq("SHARED").or(CONTACT_ENTRY.OWNER_ID.eq(callerId)));

    Table<?> d = members.unionAll(external).asTable("d");
    Field<String> dType = d.field("type", String.class);
    Field<Long> dId = d.field("id", Long.class);
    Field<String> dName = d.field("name", String.class);
    Field<String> dEmail = d.field("email", String.class);
    Field<String> dTitle = d.field("title", String.class);
    Field<String> dOrg = d.field("organization", String.class);
    Field<Boolean> dFav = d.field("is_favorite", Boolean.class);

    Condition where = DSL.noCondition();
    if (search != null && !search.isBlank()) {
      String q = "%" + search.trim() + "%";
      where = where.and(dName.likeIgnoreCase(q).or(dEmail.likeIgnoreCase(q)));
    }
    if (!"ALL".equals(type)) {
      where = where.and(dType.eq(type));
    }
    if (favorite) {
      where = where.and(dFav.isTrue());
    }
    // 조직·직책 정확 일치(값이 facet 목록에서 옴 — LIKE 아님). EXTERNAL 분기만 organization 보유.
    if (organization != null && !organization.isBlank()) {
      where = where.and(dOrg.eq(organization));
    }
    if (title != null && !title.isBlank()) {
      where = where.and(dTitle.eq(title));
    }
    if (cursor != null) {
      // (name, type, id) > (커서) — 사전식 키셋
      where =
          where.and(
              DSL.row(dName, dType, dId).gt(DSL.row(cursor.name(), cursor.type(), cursor.id())));
    }

    return dsl.select(dType, dId, dName, dEmail, dTitle, dOrg, dFav)
        .from(d)
        .where(where)
        .orderBy(dName.asc(), dType.asc(), dId.asc())
        .limit(limit)
        .fetch(
            r ->
                new ContactSummary(
                    r.get(dType),
                    r.get(dId),
                    r.get(dName),
                    r.get(dEmail),
                    r.get(dTitle),
                    r.get(dOrg),
                    Boolean.TRUE.equals(r.get(dFav))));
  }

  /**
   * 가시 외부 연락처의 organization·title distinct 목록. 가시성은 목록과 동일(SHARED 전체 + 본인 PERSONAL)으로 적용해 타인
   * PERSONAL 값 누출을 막는다. null/공백 제외, 알파벳 오름차순. 멤버(user)는 외부 전용 필터라 미포함.
   */
  public ContactFacets distinctExternalFacets(long callerId) {
    Condition visible =
        CONTACT_ENTRY.VISIBILITY.eq("SHARED").or(CONTACT_ENTRY.OWNER_ID.eq(callerId));

    List<String> orgs =
        dsl.selectDistinct(CONTACT_ENTRY.ORGANIZATION)
            .from(CONTACT_ENTRY)
            .where(visible)
            .and(CONTACT_ENTRY.ORGANIZATION.isNotNull())
            .and(DSL.trim(CONTACT_ENTRY.ORGANIZATION).ne(""))
            .orderBy(CONTACT_ENTRY.ORGANIZATION.asc())
            .fetch(CONTACT_ENTRY.ORGANIZATION);

    List<String> titles =
        dsl.selectDistinct(CONTACT_ENTRY.TITLE)
            .from(CONTACT_ENTRY)
            .where(visible)
            .and(CONTACT_ENTRY.TITLE.isNotNull())
            .and(DSL.trim(CONTACT_ENTRY.TITLE).ne(""))
            .orderBy(CONTACT_ENTRY.TITLE.asc())
            .fetch(CONTACT_ENTRY.TITLE);

    return new ContactFacets(orgs, titles);
  }

  /** callerId 기준 (targetType,targetId) 즐겨찾기 존재 여부. 상세 조회의 isFavorite 계산용. */
  private boolean isFavorite(long callerId, String targetType, long targetId) {
    return dsl.fetchExists(
        DSL.selectOne()
            .from(CONTACT_FAVORITE)
            .where(CONTACT_FAVORITE.OWNER_ID.eq(callerId))
            .and(CONTACT_FAVORITE.TARGET_TYPE.eq(targetType))
            .and(CONTACT_FAVORITE.TARGET_ID.eq(targetId)));
  }

  /** 멤버 상세 — kind=HUMAN 만. 소속 그룹명·callerId 기준 즐겨찾기 여부 포함. 없으면 empty. */
  public Optional<MemberDetail> findMember(long callerId, long userId) {
    var profile =
        dsl.select(USER.ID, USER.USERNAME, USER.NAME, USER.EMAIL, USER.TITLE, USER.KIND)
            .from(USER)
            .where(USER.ID.eq(userId))
            .and(USER.KIND.eq("HUMAN"))
            .fetchOne();
    if (profile == null) return Optional.empty();

    List<String> groups =
        dsl.select(USER_GROUP.NAME)
            .from(USER_GROUP_MEMBER)
            .join(USER_GROUP)
            .on(USER_GROUP.ID.eq(USER_GROUP_MEMBER.GROUP_ID))
            .where(USER_GROUP_MEMBER.TARGET_TYPE.eq("MEMBER"))
            .and(USER_GROUP_MEMBER.TARGET_ID.eq(userId))
            .orderBy(USER_GROUP.NAME.asc())
            .fetch(USER_GROUP.NAME);

    return Optional.of(
        new MemberDetail(
            profile.get(USER.ID),
            profile.get(USER.USERNAME),
            profile.get(USER.NAME),
            profile.get(USER.EMAIL),
            profile.get(USER.TITLE),
            profile.get(USER.KIND),
            groups,
            isFavorite(callerId, "MEMBER", userId)));
  }

  /** 외부 상세 — SHARED 또는 본인 PERSONAL 만. editable = 본인 owner || isAdmin. 격리 위반/미존재는 empty. */
  public Optional<ExternalContactDetail> findExternal(long callerId, boolean isAdmin, long id) {
    return dsl.select(
            CONTACT_ENTRY.ID,
            CONTACT_ENTRY.NAME,
            CONTACT_ENTRY.EMAIL,
            CONTACT_ENTRY.PHONE,
            CONTACT_ENTRY.ORGANIZATION,
            CONTACT_ENTRY.TITLE,
            CONTACT_ENTRY.NOTES,
            CONTACT_ENTRY.VISIBILITY,
            CONTACT_ENTRY.OWNER_ID,
            CONTACT_ENTRY.CREATED_AT,
            CONTACT_ENTRY.UPDATED_AT)
        .from(CONTACT_ENTRY)
        .where(CONTACT_ENTRY.ID.eq(id))
        .and(
            CONTACT_ENTRY
                .VISIBILITY
                .eq("SHARED")
                .or(CONTACT_ENTRY.OWNER_ID.eq(callerId))
                .or(DSL.condition(isAdmin)))
        .fetchOptional(
            r ->
                new ExternalContactDetail(
                    r.get(CONTACT_ENTRY.ID),
                    r.get(CONTACT_ENTRY.NAME),
                    r.get(CONTACT_ENTRY.EMAIL),
                    r.get(CONTACT_ENTRY.PHONE),
                    r.get(CONTACT_ENTRY.ORGANIZATION),
                    r.get(CONTACT_ENTRY.TITLE),
                    r.get(CONTACT_ENTRY.NOTES),
                    r.get(CONTACT_ENTRY.VISIBILITY),
                    isAdmin || r.get(CONTACT_ENTRY.OWNER_ID).equals(callerId),
                    isFavorite(callerId, "EXTERNAL", id),
                    r.get(CONTACT_ENTRY.CREATED_AT),
                    r.get(CONTACT_ENTRY.UPDATED_AT)));
  }

  /** update/delete 권한 판정용 경량 조회 결과. */
  public record OwnerVisibility(long ownerId, String visibility) {}

  /** owner_id + visibility 만 조회(없으면 empty). 권한 체크 전용. */
  public Optional<OwnerVisibility> findOwnerVisibility(long id) {
    return dsl.select(CONTACT_ENTRY.OWNER_ID, CONTACT_ENTRY.VISIBILITY)
        .from(CONTACT_ENTRY)
        .where(CONTACT_ENTRY.ID.eq(id))
        .fetchOptional(
            r ->
                new OwnerVisibility(
                    r.get(CONTACT_ENTRY.OWNER_ID), r.get(CONTACT_ENTRY.VISIBILITY)));
  }

  /** 외부 연락처 생성 — 빈 문자열 optional 은 null 정규화. 생성된 id 반환. */
  public long insert(long ownerId, ExternalContactRequest req) {
    return dsl.insertInto(CONTACT_ENTRY)
        .set(CONTACT_ENTRY.NAME, req.name())
        .set(CONTACT_ENTRY.EMAIL, nullIfBlank(req.email()))
        .set(CONTACT_ENTRY.PHONE, nullIfBlank(req.phone()))
        .set(CONTACT_ENTRY.ORGANIZATION, nullIfBlank(req.organization()))
        .set(CONTACT_ENTRY.TITLE, nullIfBlank(req.title()))
        .set(CONTACT_ENTRY.NOTES, nullIfBlank(req.notes()))
        .set(CONTACT_ENTRY.OWNER_ID, ownerId)
        .set(CONTACT_ENTRY.VISIBILITY, req.visibility())
        .returning(CONTACT_ENTRY.ID)
        .fetchOne()
        .getId();
  }

  /** 외부 연락처 전체 교체 + updated_at 갱신. 권한은 service 에서 검증한 뒤 호출. */
  public void update(long id, ExternalContactRequest req) {
    dsl.update(CONTACT_ENTRY)
        .set(CONTACT_ENTRY.NAME, req.name())
        .set(CONTACT_ENTRY.EMAIL, nullIfBlank(req.email()))
        .set(CONTACT_ENTRY.PHONE, nullIfBlank(req.phone()))
        .set(CONTACT_ENTRY.ORGANIZATION, nullIfBlank(req.organization()))
        .set(CONTACT_ENTRY.TITLE, nullIfBlank(req.title()))
        .set(CONTACT_ENTRY.NOTES, nullIfBlank(req.notes()))
        .set(CONTACT_ENTRY.VISIBILITY, req.visibility())
        .set(CONTACT_ENTRY.UPDATED_AT, OffsetDateTime.now())
        .where(CONTACT_ENTRY.ID.eq(id))
        .execute();
  }

  /** 외부 연락처 삭제. 권한은 service 에서 검증한 뒤 호출. */
  public void delete(long id) {
    dsl.deleteFrom(CONTACT_ENTRY).where(CONTACT_ENTRY.ID.eq(id)).execute();
  }

  private static String nullIfBlank(String s) {
    return (s == null || s.isBlank()) ? null : s;
  }
}
