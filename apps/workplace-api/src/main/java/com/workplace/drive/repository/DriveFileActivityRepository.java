package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FILE_ACTIVITY;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;

import com.workplace.drive.domain.DriveFileAction;
import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 드라이브 「최근」 기록(drive_file_activity, WP-1699) 접근. 한 사람이 어떤 파일을 열거나 올리거나 새 판을 올린 기록을 한 사람·한 파일 한 행으로
 * 남기고, 내 목록을 최근 순으로 읽는다. 모든 메서드는 워크스페이스 RLS 컨텍스트(TenantContext) 안에서 부른다(FORCE RLS).
 */
@Repository
@RequiredArgsConstructor
public class DriveFileActivityRepository {

  /** 사람마다 남기는 기록 수 상한 — 새 행을 넣을 때만 오래된 것부터 이만큼 넘는 줄을 지운다. */
  public static final int PER_USER_CAP = 500;

  /** 같은 파일 다시 열기를 쓰지 않는 창(초) — 보기 창의 미리보기 폴링·내용 반복 요청이 행을 계속 건드리지 않게 한다. */
  public static final int OPEN_DEDUPE_SECONDS = 60;

  /**
   * upsert 한 문장. 새 행이거나 갱신이면 행을 돌려주고, 1분 안 OPEN 이라 건너뛰면(WHERE 불일치) 아무 행도 돌려주지 않는다. {@code xmax = 0}
   * 은 이번 문장이 INSERT 했음을 뜻한다(갱신된 행은 xmax 가 0 이 아니다) — 새 행일 때만 상한 정리를 한다.
   *
   * <p>결정: 1분 건너뛰기는 새 행동이 OPEN 이고 기존 행의 last_at 이 60초 안이면 <b>기존 행동이 무엇이든</b> 건너뛴다(「같은 파일을 1분 안에 다시
   * 열면 쓰지 않는다」). 올린 직후 열어도 「올림」이 「열었음」으로 덮이거나 시각이 밀리지 않는다. UPLOAD·NEW_VERSION 은 항상 갱신한다(최근 행동이
   * 이긴다).
   */
  private static final String UPSERT_SQL =
      "INSERT INTO drive_file_activity (user_id, drive_file_id, last_action) VALUES (?, ?, ?) "
          + "ON CONFLICT (user_id, drive_file_id) DO UPDATE "
          + "  SET last_action = EXCLUDED.last_action, last_at = now() "
          + "  WHERE NOT (EXCLUDED.last_action = 'OPEN' "
          + "             AND drive_file_activity.last_at > now() - make_interval(secs => ?)) "
          + "RETURNING (xmax = 0) AS inserted";

  /** 사람 한 명의 기록 중 최근 PER_USER_CAP 개 밖(초과분)만 골라 지운다 — 남길 행 전체를 NOT IN 으로 비교하지 않는다. */
  private static final String TRIM_SQL =
      "DELETE FROM drive_file_activity WHERE id IN ("
          + "  SELECT id FROM drive_file_activity WHERE user_id = ? "
          + "  ORDER BY last_at DESC, id DESC OFFSET ?)";

  private final DSLContext dsl;

  /**
   * 행동을 기록한다(upsert). 호출한 트랜잭션과 따로 커밋한다(REQUIRES_NEW) — 호출 쪽이 롤백돼도 이 기록은 남고, 이 기록이 롤백돼도 호출 쪽은 영향이
   * 없다. 단 이 메서드의 예외(FK 위반 등)는 그대로 호출자에게 전파되므로, 호출하는 쪽(DriveFileActivityRecorder)이 잡아 로그만 남겨야 한다. 새
   * 트랜잭션에도 TenantAwareTransactionManager 가 테넌트 GUC 를 주입하므로 RLS 가 유지된다. 호출 쪽 트랜잭션이 새로 만든 drive_file
   * 은 그 커밋 뒤에야 이 트랜잭션에서 보이니, 업로드 기록은 커밋 뒤에 불러야 한다.
   */
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void upsert(long userId, long driveFileId, DriveFileAction action) {
    var row =
        dsl.fetchOptional(UPSERT_SQL, userId, driveFileId, action.name(), OPEN_DEDUPE_SECONDS);
    boolean inserted = row.map(r -> Boolean.TRUE.equals(r.get(0, Boolean.class))).orElse(false);
    // 갱신만으로는 행이 늘지 않으니 새 행일 때만 정리한다.
    if (inserted) {
      dsl.execute(TRIM_SQL, userId, PER_USER_CAP);
    }
  }

  /** 목록 다음 쪽의 시작점 — 직전 쪽 마지막 줄의 (last_at, id). 같은 시각 줄들도 id 로 갈라 빠지거나 겹치지 않는다. */
  public record Cursor(OffsetDateTime lastAt, long id) {}

  /**
   * 목록 한 줄. spaceType·spaceOwnerName 은 개인 공간 이름(「내 드라이브」 → 주인 이름) 표시용(spaceOwnerId 로 내 공간인지 가른다),
   * folderId 는 NULL 이면 공간 루트.
   */
  public record ActivityRow(
      long id,
      long driveFileId,
      String name,
      String mimeType,
      long sizeBytes,
      long spaceId,
      String spaceType,
      String spaceName,
      String spaceOwnerName,
      Long spaceOwnerId,
      Long folderId,
      DriveFileAction lastAction,
      OffsetDateTime lastAt) {}

  /**
   * 내 기록을 최근 순((last_at, id) 내림차순)으로 limit 줄. 휴지통 파일과 지금 그 공간의 실효 역할(부서 역할 포함)이 없는 파일은 SQL 안에서 거른다
   * — 자르기 전에 걸러야 볼 수 없는 줄이 많아도 쪽이 짧아지지 않는다. after 가 있으면 그 뒤부터.
   */
  public List<ActivityRow> listForUser(long userId, Cursor after, int limit) {
    com.workplace.jooq.tables.User owner = USER.as("dfa_owner");
    Condition where =
        DRIVE_FILE_ACTIVITY
            .USER_ID
            .eq(userId)
            .and(DRIVE_FILE.TRASHED_AT.isNull())
            .and(
                DriveSpaceMembership.effectiveRole(DRIVE_FILE.SPACE_ID, DSL.val(userId))
                    .isNotNull());
    if (after != null) {
      where =
          where.and(
              DSL.row(DRIVE_FILE_ACTIVITY.LAST_AT, DRIVE_FILE_ACTIVITY.ID)
                  .lt(DSL.row(after.lastAt(), after.id())));
    }
    return dsl.select(
            DRIVE_FILE_ACTIVITY.ID,
            DRIVE_FILE_ACTIVITY.DRIVE_FILE_ID,
            DRIVE_FILE.NAME,
            FILE.MIME_TYPE,
            FILE.SIZE_BYTES,
            DRIVE_FILE.SPACE_ID,
            DRIVE_SPACE.TYPE,
            DRIVE_SPACE.NAME,
            owner.NAME,
            DRIVE_SPACE.OWNER_ID,
            DRIVE_FILE.FOLDER_ID,
            DRIVE_FILE_ACTIVITY.LAST_ACTION,
            DRIVE_FILE_ACTIVITY.LAST_AT)
        .from(DRIVE_FILE_ACTIVITY)
        .join(DRIVE_FILE)
        .on(DRIVE_FILE.ID.eq(DRIVE_FILE_ACTIVITY.DRIVE_FILE_ID))
        .join(FILE)
        .on(FILE.ID.eq(DRIVE_FILE.FILE_ID))
        .join(DRIVE_SPACE)
        .on(DRIVE_SPACE.ID.eq(DRIVE_FILE.SPACE_ID))
        .leftJoin(owner)
        .on(owner.ID.eq(DRIVE_SPACE.OWNER_ID))
        .where(where)
        .orderBy(DRIVE_FILE_ACTIVITY.LAST_AT.desc(), DRIVE_FILE_ACTIVITY.ID.desc())
        .limit(limit)
        .fetch(
            r ->
                new ActivityRow(
                    r.get(DRIVE_FILE_ACTIVITY.ID),
                    r.get(DRIVE_FILE_ACTIVITY.DRIVE_FILE_ID),
                    r.get(DRIVE_FILE.NAME),
                    r.get(FILE.MIME_TYPE),
                    r.get(FILE.SIZE_BYTES),
                    r.get(DRIVE_FILE.SPACE_ID),
                    r.get(DRIVE_SPACE.TYPE),
                    r.get(DRIVE_SPACE.NAME),
                    r.get(owner.NAME),
                    r.get(DRIVE_SPACE.OWNER_ID),
                    r.get(DRIVE_FILE.FOLDER_ID),
                    DriveFileAction.valueOf(r.get(DRIVE_FILE_ACTIVITY.LAST_ACTION)),
                    r.get(DRIVE_FILE_ACTIVITY.LAST_AT)));
  }
}
