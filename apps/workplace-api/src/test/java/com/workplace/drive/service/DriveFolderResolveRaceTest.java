package com.workplace.drive.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_CREATED;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_FOLDER;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.workplace.drive.exception.DriveDuplicateNameException;
import com.workplace.drive.outbound.DriveChangeNotifier;
import com.workplace.drive.repository.DriveFolderRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.RowLockWaits;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 폴더 merge 해석(resolveOrCreate)을 같은 이름으로 동시에 불러도 모두 같은 폴더를 받는다(WP-1619).
 *
 * <p>고치기 전에는 「찾기 → 없으면 넣기」 사이가 비어 있어, 아직 없는 이름을 동시에 부르면 먼저 넣은 하나만 성공하고 나머지는 유니크 인덱스
 * (uq_drive_folder_name) 위반으로 409 가 났다. 폴더 업로드는 같은 경로의 폴더를 여러 파일이 함께 해석하므로 업로드가 반쯤 실패했다. 서비스가 커밋해야
 * 다른 커넥션에 보이므로 클래스 레벨 @Transactional 없이 돌리고 공간째 정리한다. 같은 「확인 → 넣기」 틈이 있던 일반 폴더 만들기(create)와, 충돌 대상
 * 없는 ON CONFLICT 가 기대는 유니크 인덱스 목록도 함께 지킨다.
 */
class DriveFolderResolveRaceTest extends IntegrationTestBase {

  private static final int CONCURRENT = 8;

  @Autowired DriveFolderService folderService;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveChangeNotifier notifier;
  @Autowired DriveFolderRepository folders;

  private long ownerId;
  private long spaceId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = TestFixtures.createHuman(baseDsl);
    TestFixtures.addMember(baseDsl, ownerId, 1L);
    spaceId =
        spaceService
            .createTeamSpace(ownerId, "resolve_" + UUID.randomUUID().toString().substring(0, 8))
            .id();
    // 준비 중의 공간 생성 알림은 셈에서 뺀다 — 각 테스트는 생성(OP_CREATED) 알림 횟수만 본다.
    clearInvocations(notifier);
  }

  @AfterEach
  void cleanup() {
    baseDsl
        .update(DRIVE_FOLDER)
        .setNull(DRIVE_FOLDER.PARENT_ID)
        .where(DRIVE_FOLDER.SPACE_ID.eq(spaceId))
        .execute();
    baseDsl.deleteFrom(DRIVE_FOLDER).where(DRIVE_FOLDER.SPACE_ID.eq(spaceId)).execute();
    baseDsl.deleteFrom(DRIVE_SPACE_MEMBER).where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId)).execute();
    baseDsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(spaceId)).execute();
    baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.eq(ownerId)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.eq(ownerId)).execute();
    TenantContext.clear();
  }

  @Test
  void 루트에서_같은_새_이름을_동시에_해석해도_모두_같은_폴더를_받는다() throws Exception {
    assertAllResolveToOne(null, "동시폴더");
  }

  @Test
  void 하위_폴더에서_같은_새_이름을_동시에_해석해도_모두_같은_폴더를_받는다() throws Exception {
    long parent = folderService.create(ownerId, spaceId, null, "상위").id();
    assertAllResolveToOne(parent, "동시하위");
  }

  /**
   * 경합을 결정적으로 만든다 — 첫 해석이 폴더를 넣고 커밋하기 전에 멈춘 사이 둘째 해석을 보낸다. 둘째가 넣기에서 첫 트랜잭션의 잠금을 실제로 기다리는 것을
   * pg_locks 로 확인한 뒤 첫 해석을 커밋시키므로, ON CONFLICT 가 기다렸다 DO NOTHING 이 되는 길을 반드시 지난다. 둘째는 첫 커밋 뒤 같은 폴더를
   * 받아야 한다(고치기 전에는 여기서 유니크 위반).
   */
  @Test
  void 먼저_넣은_해석이_커밋하기_전에_들어온_해석도_그_폴더를_받는다() throws Exception {
    CountDownLatch firstInserted = new CountDownLatch(1);
    CountDownLatch releaseFirst = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<Long> first =
          pool.submit(
              () ->
                  callInTenant(
                      1L,
                      () -> {
                        long id = folderService.resolveOrCreate(ownerId, spaceId, null, "겹침").id();
                        firstInserted.countDown();
                        RowLockWaits.awaitQuietly(releaseFirst);
                        return id;
                      }));
      assertThat(firstInserted.await(10, TimeUnit.SECONDS)).isTrue();
      Future<Object> second =
          pool.submit(
              () -> {
                try {
                  return callInTenant(
                      1L, () -> folderService.resolveOrCreate(ownerId, spaceId, null, "겹침").id());
                } catch (RuntimeException e) {
                  return e;
                }
              });
      // 둘째가 넣기에서 첫 트랜잭션의 잠금을 기다리기 시작할 때까지 본 뒤 첫 해석을 커밋시킨다.
      RowLockWaits.awaitLockWaiter(second);
      releaseFirst.countDown();
      long firstId = first.get(20, TimeUnit.SECONDS);
      Object secondResult = second.get(20, TimeUnit.SECONDS);

      assertThat(secondResult).as("둘째 해석 결과: %s", secondResult).isEqualTo(firstId);
      assertThat(liveCount(null, "겹침")).isEqualTo(1);
      // 실제로 만든 첫 해석만 생성 알림을 낸다.
      verify(notifier, times(1)).itemsChanged(eq(OP_CREATED), eq(spaceId), anyCollection(), any());
    } finally {
      releaseFirst.countDown();
      pool.shutdownNow();
      pool.awaitTermination(30, TimeUnit.SECONDS);
    }
  }

  @Test
  void 순차로_두_번_해석하면_같은_폴더를_받고_생성_알림은_한_번이다() {
    long first = folderService.resolveOrCreate(ownerId, spaceId, null, "순차").id();
    long second = folderService.resolveOrCreate(ownerId, spaceId, null, "순차").id();

    assertThat(second).isEqualTo(first);
    assertThat(liveCount(null, "순차")).isEqualTo(1);
    verify(notifier, times(1)).itemsChanged(eq(OP_CREATED), eq(spaceId), anyCollection(), any());
  }

  @Test
  void insertIfAbsent_없으면_새_id_있으면_empty() {
    long id = callInTenant(1L, () -> folders.insertIfAbsent(spaceId, null, "넣기")).orElseThrow();
    assertThat(callInTenant(1L, () -> folders.insertIfAbsent(spaceId, null, "넣기"))).isEmpty();
    assertThat(liveCount(null, "넣기")).isEqualTo(1);
    // 기존 insert 와 같이 tenant_id 가 트랜잭션 GUC(DEFAULT)로 채워진다.
    assertThat(
            baseDsl
                .select(DRIVE_FOLDER.TENANT_ID)
                .from(DRIVE_FOLDER)
                .where(DRIVE_FOLDER.ID.eq(id))
                .fetchOne(DRIVE_FOLDER.TENANT_ID))
        .isEqualTo(1L);
  }

  @Test
  void insertIfAbsent_휴지통에_같은_이름이_있으면_새로_만든다() {
    long trashed =
        callInTenant(1L, () -> folders.insertIfAbsent(spaceId, null, "버림")).orElseThrow();
    callInTenant(
        1L,
        () -> {
          folderService.delete(ownerId, trashed);
          return null;
        });

    var fresh = callInTenant(1L, () -> folders.insertIfAbsent(spaceId, null, "버림"));
    assertThat(fresh).isPresent();
    assertThat(fresh.get()).isNotEqualTo(trashed);
    assertThat(liveCount(null, "버림")).isEqualTo(1);
  }

  /**
   * 넣기와 다시 찾기 사이에 먼저 만든 폴더가 사라지면(휴지통·이름 바꾸기) 409 대신 넣기부터 다시 해 새로 만든다. 웹 업로드 큐는 resolve 를 다시 부르지
   * 않으므로 서버가 버텨야 한다. 첫 넣기가 「이미 있음」으로 비고 다시 찾기도 비는 엇갈림을 저장소 spy 로 만든다.
   */
  @Test
  void 넣기와_다시_찾기가_엇갈리면_다시_넣어_만들고_생성_알림은_한_번이다() {
    doReturn(Optional.empty())
        .doCallRealMethod()
        .when(folders)
        .insertIfAbsent(anyLong(), any(), anyString());

    long id = folderService.resolveOrCreate(ownerId, spaceId, null, "엇갈림").id();

    assertThat(liveCount(null, "엇갈림")).isEqualTo(1);
    verify(folders, times(2)).insertIfAbsent(anyLong(), any(), anyString());
    verify(notifier, times(1)).itemsChanged(eq(OP_CREATED), eq(spaceId), eq(List.of(id)), any());
  }

  @Test
  void 정해진_횟수만큼_계속_엇갈리면_같은_이름_충돌로_알리고_알림은_없다() {
    doReturn(Optional.empty()).when(folders).insertIfAbsent(anyLong(), any(), anyString());

    assertThatThrownBy(() -> folderService.resolveOrCreate(ownerId, spaceId, null, "계속엇갈림"))
        .isInstanceOf(DriveDuplicateNameException.class);
    verify(folders, times(DriveFolderService.RESOLVE_MAX_ATTEMPTS))
        .insertIfAbsent(anyLong(), any(), anyString());
    verify(notifier, never()).itemsChanged(eq(OP_CREATED), anyLong(), anyCollection(), any());
  }

  /**
   * 일반 폴더 만들기(create)도 같은 이름을 동시에 만들면 하나만 성공하고 나머지는 같은 이름 충돌(DriveDuplicateNameException → 409)이다.
   * 고치기 전에는 「있나 확인 → 넣기」 사이로 DB 유니크 위반(DuplicateKeyException)이 그대로 새었다.
   */
  @Test
  void 같은_이름을_동시에_만들면_하나만_성공하고_나머지는_같은_이름_충돌이다() throws Exception {
    List<Object> results =
        runConcurrently(() -> folderService.create(ownerId, spaceId, null, "동시생성").id());

    long ok = results.stream().filter(r -> r instanceof Long).count();
    long dup = results.stream().filter(r -> r instanceof DriveDuplicateNameException).count();
    assertThat(ok).as("결과: %s", results).isEqualTo(1);
    assertThat(dup).as("나머지는 같은 이름 충돌: %s", results).isEqualTo(CONCURRENT - 1);
    assertThat(liveCount(null, "동시생성")).isEqualTo(1);
    verify(notifier, times(1)).itemsChanged(eq(OP_CREATED), eq(spaceId), anyCollection(), any());
  }

  /**
   * insertIfAbsent 는 충돌 대상 없는 ON CONFLICT DO NOTHING 이라 이 표의 모든 유니크 인덱스 위반을 조용히 삼킨다. 지금은 PK 와
   * uq_drive_folder_name 뿐이라 「같은 이름이 이미 있음」만 뜻한다 — 유니크가 늘면 그 위반도 「이미 있음」으로 오해하게 되므로 여기서 막는다.
   */
  @Test
  void drive_folder_의_유니크_인덱스는_PK_와_이름_인덱스뿐이다() {
    List<String> unique =
        baseDsl
            .select(DSL.field("indexname", String.class))
            .from(DSL.table("pg_indexes"))
            .where(DSL.condition("schemaname = 'public'"))
            .and(DSL.condition("tablename = 'drive_folder'"))
            .and(DSL.condition("indexdef LIKE 'CREATE UNIQUE INDEX%'"))
            .fetch(DSL.field("indexname", String.class));
    assertThat(unique)
        .as(
            "drive_folder 에 유니크 인덱스가 바뀌었다 — DriveFolderRepository.insertIfAbsent 의 대상 없는 ON CONFLICT DO NOTHING 이"
                + " 새 유니크 위반까지 「이미 있음」으로 삼키지 않는지 다시 살피고(필요하면 충돌 대상을 명시) 이 목록을 고친다")
        .containsExactlyInAnyOrder("drive_folder_pkey", "uq_drive_folder_name");
  }

  /** CONCURRENT 개 해석을 한꺼번에 출발시켜 모두 같은 id 를 받고, 살아있는 폴더는 하나, 생성 알림도 한 번인지 확인한다. */
  private void assertAllResolveToOne(Long parentId, String name) throws Exception {
    List<Object> results =
        runConcurrently(() -> folderService.resolveOrCreate(ownerId, spaceId, parentId, name).id());

    assertThat(results).as("모두 성공해야 한다: %s", results).allMatch(r -> r instanceof Long);
    assertThat(results.stream().distinct().count()).as("모두 같은 폴더: %s", results).isEqualTo(1);
    assertThat(liveCount(parentId, name)).isEqualTo(1);
    // 해석된 그 폴더의 생성 알림만 센다 — 하위 폴더 테스트가 미리 만든 부모 폴더의 알림은 셈에서 뺀다.
    verify(notifier, times(1))
        .itemsChanged(eq(OP_CREATED), eq(spaceId), eq(List.of((Long) results.get(0))), any());
  }

  /** body 를 CONCURRENT 개 스레드에서 한꺼번에 출발시켜 각 결과(값 또는 예외)를 돌려준다. */
  private List<Object> runConcurrently(Supplier<Object> body) throws Exception {
    ExecutorService pool = Executors.newFixedThreadPool(CONCURRENT);
    CountDownLatch start = new CountDownLatch(1);
    try {
      List<Future<Object>> futures = new ArrayList<>();
      for (int i = 0; i < CONCURRENT; i++) {
        futures.add(
            pool.submit(
                () -> {
                  start.await(10, TimeUnit.SECONDS);
                  try {
                    return callInTenant(1L, body);
                  } catch (RuntimeException e) {
                    return e;
                  }
                }));
      }
      start.countDown();
      List<Object> results = new ArrayList<>();
      for (Future<Object> f : futures) results.add(f.get(60, TimeUnit.SECONDS));
      return results;
    } finally {
      pool.shutdownNow();
      pool.awaitTermination(30, TimeUnit.SECONDS);
    }
  }

  /** 그 공간·부모·이름의 살아있는 폴더 수. */
  private int liveCount(Long parentId, String name) {
    return baseDsl.fetchCount(
        DRIVE_FOLDER,
        DRIVE_FOLDER
            .SPACE_ID
            .eq(spaceId)
            .and(
                parentId == null
                    ? DRIVE_FOLDER.PARENT_ID.isNull()
                    : DRIVE_FOLDER.PARENT_ID.eq(parentId))
            .and(DRIVE_FOLDER.NAME.eq(name))
            .and(DRIVE_FOLDER.TRASHED_AT.isNull()));
  }
}
