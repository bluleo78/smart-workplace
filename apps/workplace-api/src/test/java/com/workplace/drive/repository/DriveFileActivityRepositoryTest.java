package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.domain.DriveFileAction;
import com.workplace.drive.repository.DriveFileActivityRepository.ActivityRow;
import com.workplace.drive.repository.DriveFileActivityRepository.Cursor;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 드라이브 「최근」 기록 저장소(WP-1699) 통합 테스트.
 *
 * <p>upsert 가 REQUIRES_NEW 로 따로 커밋하므로, 테스트 트랜잭션 안에 시드하면 그 트랜잭션에서 FK 대상이 보이지 않는다 — 그래서 롤백 격리 대신 커밋하는
 * 시드를 쓰고 {@code @AfterEach} 에서 공간·사용자를 지워 정리한다(공간 삭제가 drive_file → drive_file_activity 로 CASCADE).
 */
class DriveFileActivityRepositoryTest extends IntegrationTestBase {
  private static final long TENANT_ID = 1L;

  @Autowired DriveFileActivityRepository repo;

  private long me;
  private long other;
  private long mySpace;
  private long otherSpace;
  private final List<Long> spaces = new ArrayList<>();
  private final List<Long> users = new ArrayList<>();

  @BeforeEach
  void seed() {
    TenantContext.set(TENANT_ID);
    me = newUser();
    other = newUser();
    mySpace = newSpace(me);
    otherSpace = newSpace(other);
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        TENANT_ID,
        () -> {
          baseDsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.in(spaces)).execute();
          baseDsl.deleteFrom(FILE).where(FILE.UPLOADED_BY.in(users)).execute();
        });
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    TenantContext.clear();
  }

  @Test
  void upsert_insertsOneRowPerUserAndFile() {
    long f = newFile(mySpace, me);
    repo.upsert(me, f, DriveFileAction.OPEN);
    pullBack(me, f, "5 minutes");
    repo.upsert(me, f, DriveFileAction.OPEN);

    assertThat(countRows(me)).isEqualTo(1);
  }

  @Test
  void upsert_openWithinOneMinute_doesNotTouchLastAt() {
    long f = newFile(mySpace, me);
    repo.upsert(me, f, DriveFileAction.OPEN);
    pullBack(me, f, "30 seconds");
    OffsetDateTime before = lastAt(me, f);

    repo.upsert(me, f, DriveFileAction.OPEN);

    assertThat(lastAt(me, f)).isEqualTo(before);
  }

  @Test
  void upsert_openAfterOneMinute_updatesLastAt() {
    long f = newFile(mySpace, me);
    repo.upsert(me, f, DriveFileAction.OPEN);
    pullBack(me, f, "2 minutes");
    OffsetDateTime before = lastAt(me, f);

    repo.upsert(me, f, DriveFileAction.OPEN);

    assertThat(lastAt(me, f)).isAfter(before);
  }

  @Test
  void upsert_uploadAfterRecentOpen_updatesAction() {
    long f = newFile(mySpace, me);
    repo.upsert(me, f, DriveFileAction.OPEN);

    repo.upsert(me, f, DriveFileAction.NEW_VERSION);

    assertThat(lastAction(me, f)).isEqualTo("NEW_VERSION");
  }

  @Test
  void upsert_openWithinOneMinuteAfterUpload_keepsUpload() {
    // 결정: 1분 안의 OPEN 은 직전 행동이 무엇이든 건너뛴다 — 올린 직후 열어도 「올림」이 「열었음」으로 덮이지 않는다.
    long f = newFile(mySpace, me);
    repo.upsert(me, f, DriveFileAction.UPLOAD);

    repo.upsert(me, f, DriveFileAction.OPEN);

    assertThat(lastAction(me, f)).isEqualTo("UPLOAD");
  }

  @Test
  void upsert_capsAt500_onInsertOnly() {
    List<Long> files = new ArrayList<>();
    for (int i = 0; i < DriveFileActivityRepository.PER_USER_CAP; i++)
      files.add(newFile(mySpace, me));
    // 500개를 한 번에 채운다(저장소 호출 500번 대신 SQL) — 가장 오래된 것부터 1분 간격으로 과거에 둔다.
    baseDsl.execute(
        "INSERT INTO drive_file_activity (user_id, drive_file_id, last_action, last_at) "
            + "SELECT ?, id, 'UPLOAD', now() - (id * interval '1 minute') FROM drive_file WHERE space_id = ?",
        me,
        mySpace);
    assertThat(countRows(me)).isEqualTo(500);

    // 이미 있는 파일을 갱신하는 것만으로는 지우지 않는다.
    long existing = files.get(files.size() - 1);
    repo.upsert(me, existing, DriveFileAction.NEW_VERSION);
    assertThat(countRows(me)).isEqualTo(500);

    // 갱신 뒤의 가장 오래된 기록 — 새 행이 들어오면 이것이 빠져야 한다.
    long oldest =
        (long)
            baseDsl.fetchValue(
                "SELECT drive_file_id FROM drive_file_activity WHERE user_id = ? ORDER BY last_at ASC LIMIT 1",
                me);
    // 새 파일 기록(INSERT)이 501번째면 가장 오래된 것이 빠진다.
    long extra = newFile(mySpace, me);
    repo.upsert(me, extra, DriveFileAction.UPLOAD);
    assertThat(countRows(me)).isEqualTo(500);
    assertThat(
            baseDsl.fetchCount(
                baseDsl.selectOne().from("drive_file_activity").where("drive_file_id = ?", oldest)))
        .isZero();
    assertThat(lastAt(me, extra)).isNotNull();
  }

  @Test
  void listForUser_filtersTrashedAndNonMember() {
    long visible = newFile(mySpace, me);
    long trashed = newFile(mySpace, me);
    long foreign = newFile(otherSpace, other);
    repo.upsert(me, visible, DriveFileAction.OPEN);
    repo.upsert(me, trashed, DriveFileAction.OPEN);
    repo.upsert(me, foreign, DriveFileAction.OPEN);
    setTrashed(trashed, true);

    assertThat(ids(list(me, null, 50))).containsExactly(visible);

    setTrashed(trashed, false);
    assertThat(ids(list(me, null, 50))).containsExactlyInAnyOrder(visible, trashed);
  }

  @Test
  void listForUser_onlyOwnRows() {
    long mine = newFile(mySpace, me);
    long theirs = newFile(otherSpace, other);
    repo.upsert(me, mine, DriveFileAction.OPEN);
    repo.upsert(other, theirs, DriveFileAction.OPEN);

    List<ActivityRow> rows = list(me, null, 50);

    assertThat(ids(rows)).containsExactly(mine);
    ActivityRow row = rows.get(0);
    assertThat(row.lastAction()).isEqualTo(DriveFileAction.OPEN);
    assertThat(row.spaceId()).isEqualTo(mySpace);
    assertThat(row.spaceType()).isEqualTo("TEAM");
    assertThat(row.name()).startsWith("a-").endsWith(".txt");
    assertThat(row.mimeType()).isEqualTo("text/plain");
    assertThat(row.sizeBytes()).isEqualTo(3L);
  }

  @Test
  void listForUser_cursorStableOnTies() {
    List<Long> files = new ArrayList<>();
    for (int i = 0; i < 3; i++) {
      long f = newFile(mySpace, me);
      files.add(f);
      repo.upsert(me, f, DriveFileAction.UPLOAD);
    }
    // 같은 시각 3줄 — 커서의 id 보조 키가 경계를 지켜야 한다.
    baseDsl.execute(
        "UPDATE drive_file_activity SET last_at = '2026-11-10T00:00:00Z' WHERE user_id = ?", me);

    List<ActivityRow> first = list(me, null, 2);
    ActivityRow tail = first.get(first.size() - 1);
    List<ActivityRow> second = list(me, new Cursor(tail.lastAt(), tail.id()), 2);

    List<Long> all = new ArrayList<>(ids(first));
    all.addAll(ids(second));
    assertThat(first).hasSize(2);
    assertThat(second).hasSize(1);
    assertThat(all).containsExactlyInAnyOrderElementsOf(files);
  }

  @Test
  void listForUser_filtersBeforeLimit() {
    List<Long> visible = new ArrayList<>();
    for (int i = 0; i < 2; i++) {
      long f = newFile(mySpace, me);
      visible.add(f);
      repo.upsert(me, f, DriveFileAction.OPEN);
    }
    baseDsl.execute(
        "UPDATE drive_file_activity SET last_at = now() - interval '1 day' WHERE user_id = ?", me);
    // 볼 수 없는 공간 기록 5줄(더 최근) — limit 로 자르기 전에 걸러야 한다.
    for (int i = 0; i < 5; i++) {
      long f = newFile(otherSpace, other);
      repo.upsert(me, f, DriveFileAction.OPEN);
    }

    assertThat(ids(list(me, null, 2))).containsExactlyInAnyOrderElementsOf(visible);
  }

  // --- 헬퍼 ---

  private List<ActivityRow> list(long userId, Cursor cursor, int limit) {
    return callInTenant(TENANT_ID, () -> repo.listForUser(userId, cursor, limit));
  }

  private static List<Long> ids(List<ActivityRow> rows) {
    return rows.stream().map(ActivityRow::driveFileId).toList();
  }

  private int countRows(long userId) {
    return baseDsl.fetchCount(
        baseDsl.selectOne().from("drive_file_activity").where("user_id = ?", userId));
  }

  private OffsetDateTime lastAt(long userId, long fileId) {
    return baseDsl
        .fetchOne(
            "SELECT last_at FROM drive_file_activity WHERE user_id = ? AND drive_file_id = ?",
            userId,
            fileId)
        .get(0, OffsetDateTime.class);
  }

  private String lastAction(long userId, long fileId) {
    return (String)
        baseDsl.fetchValue(
            "SELECT last_action FROM drive_file_activity WHERE user_id = ? AND drive_file_id = ?",
            userId,
            fileId);
  }

  /** last_at 을 DB 시계 기준 과거로 당긴다(1분 중복 방지 창 검증용). */
  private void pullBack(long userId, long fileId, String interval) {
    baseDsl.execute(
        "UPDATE drive_file_activity SET last_at = now() - ?::interval "
            + "WHERE user_id = ? AND drive_file_id = ?",
        interval,
        userId,
        fileId);
  }

  private void setTrashed(long fileId, boolean trashed) {
    baseDsl.execute(
        trashed
            ? "UPDATE drive_file SET trashed_at = now() WHERE id = ?"
            : "UPDATE drive_file SET trashed_at = NULL WHERE id = ?",
        fileId);
  }

  private long newUser() {
    long id = TestFixtures.createHuman(baseDsl);
    TestFixtures.addMember(baseDsl, id, TENANT_ID);
    users.add(id);
    return id;
  }

  /** 팀 공간 하나와 그 주인(OWNER 멤버). */
  private long newSpace(long ownerId) {
    long spaceId =
        baseDsl
            .insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, "sp-" + UUID.randomUUID().toString().substring(0, 6))
            .set(DRIVE_SPACE.OWNER_ID, ownerId)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    baseDsl
        .insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
        .set(DRIVE_SPACE_MEMBER.USER_ID, ownerId)
        .set(DRIVE_SPACE_MEMBER.ROLE, "OWNER")
        .execute();
    spaces.add(spaceId);
    return spaceId;
  }

  /** file core + drive_file 행. */
  private long newFile(long spaceId, long uploadedBy) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long coreId =
        baseDsl
            .insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, "a.txt")
            .set(FILE.STORED_NAME, "stored-" + s)
            .set(FILE.STORAGE_PATH, "/tmp/a-" + s + ".txt")
            .set(FILE.MIME_TYPE, "text/plain")
            .set(FILE.SIZE_BYTES, 3L)
            .set(FILE.UPLOADED_BY, uploadedBy)
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    return baseDsl
        .insertInto(DRIVE_FILE)
        .set(DRIVE_FILE.SPACE_ID, spaceId)
        .set(DRIVE_FILE.FILE_ID, coreId)
        .set(DRIVE_FILE.NAME, "a-" + s + ".txt")
        .returning(DRIVE_FILE.ID)
        .fetchOne()
        .getId();
  }
}
