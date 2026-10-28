package com.workplace.home.repository;

import static com.workplace.jooq.Tables.SHARED_AI_MEMORY_FORGOTTEN;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.home.repository.SharedAiMemoryChangeRepository.ChangeRow;
import com.workplace.home.repository.SharedAiMemoryRepository.Row;
import com.workplace.home.service.SearchTerms;
import com.workplace.home.service.SharedAiMemoryChangeLog;
import com.workplace.home.service.SharedAiMemoryForgottenService;
import com.workplace.home.service.SharedMemorySnapshot;
import com.workplace.home.service.SharedSpace.SpaceKey;
import com.workplace.support.FakeTextEmbedder;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-386 공용 메모리 저장소 — 공간 격리·키셋(밀리초 경계)·내용 변경 시 임베딩 초기화·스냅숏 술어·기록 JSON·지운 기록(정규화·상한·해제)·임베딩 대상·공간
 * 잠금. 롤백 트랜잭션이라 남지 않고, 공간 id 는 다른 테스트가 커밋한 행과 겹치지 않게 무작위 큰 값으로 잡아 이 테스트가 만든 행만 단언한다.
 */
@Transactional
class SharedAiMemoryStorageTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired SharedAiMemoryRepository repo;
  @Autowired SharedAiMemoryChangeRepository changes;
  @Autowired SharedAiMemoryChangeLog changeLog;
  @Autowired SharedAiMemoryForgottenRepository forgottenRepo;
  @Autowired SharedAiMemoryForgottenService forgotten;
  @Autowired TextEmbeddingRepository embeddings;
  @Autowired FakeTextEmbedder embedder;

  private final long base = 9_000_000_000L + ThreadLocalRandom.current().nextLong(1_000_000_000L);
  private final SpaceKey p1 = SpaceKey.of("PROJECT", base);
  private final SpaceKey p2 = SpaceKey.of("PROJECT", base + 1);
  private final SpaceKey org = SpaceKey.of("ORG", null);
  private final OffsetDateTime t0 = OffsetDateTime.of(2026, 10, 15, 0, 0, 0, 0, ZoneOffset.UTC);

  @BeforeEach
  void reset() {
    embedder.reset();
  }

  /** 행 → 커서(시각·id) — 서비스가 CursorCodec 으로 거치는 모양 그대로. */
  private static CursorCodec.Decoded cursorOf(Row r) {
    return CursorCodec.decode(CursorCodec.encode(r.updatedAt(), String.valueOf(r.id())));
  }

  @Test
  void 공간마다_격리되고_최신순_키셋으로_읽는다() {
    long uid = TestFixtures.createHuman(dsl);
    int orgBefore = repo.count(org);
    int orgParamBefore = repo.countsByParam().getOrDefault("ORG", 0);
    Row a = repo.insert(p1, "첫째", "USER_ADDED", uid, uid, t0);
    Row b = repo.insert(p1, "둘째", "USER_ADDED", uid, uid, t0.plusMinutes(1));
    Row c = repo.insert(p1, "셋째", "AI_EXTRACTED", null, null, t0.plusMinutes(2));
    repo.insert(p2, "다른 공간", "USER_ADDED", uid, uid, t0);
    repo.insert(org, "조직 지침", "USER_ADDED", uid, uid, t0);

    assertThat(repo.all(p1)).extracting(Row::id).containsExactly(c.id(), b.id(), a.id());
    assertThat(repo.page(p1, null, 2)).extracting(Row::id).containsExactly(c.id(), b.id());
    assertThat(repo.page(p1, cursorOf(b), 2)).extracting(Row::id).containsExactly(a.id());
    assertThat(repo.count(p1)).isEqualTo(3);
    assertThat(repo.count(org)).isEqualTo(orgBefore + 1);
    assertThat(repo.find(p2, a.id())).isEmpty();
    assertThat(repo.lock(p2, a.id())).isEmpty();
    assertThat(repo.lock(p1, a.id())).isPresent();
    assertThat(repo.countsByParam())
        .containsEntry("PROJECT:" + base, 3)
        .containsEntry("ORG", orgParamBefore + 1);
    assertThat(c.authorUserId()).isNull();
    assertThat(c.updatedBy()).isNull();
    assertThat(c.spaceKey()).isEqualTo(p1);
    assertThat(SharedAiMemoryRepository.limitOf(org)).isEqualTo(30);
    assertThat(SharedAiMemoryRepository.limitOf(p1)).isEqualTo(50);
  }

  @Test
  void 시각은_밀리초로_잘려_같은_밀리초_행도_페이지_경계에서_빠지지_않는다() {
    // 마이크로초가 남은 앱 시각 — 잘리지 않으면 밀리초 커서와 어긋나 경계 행이 빠진다.
    OffsetDateTime sameMs = t0.plusNanos(1_234_567);
    List<Row> rows = new ArrayList<>();
    for (int i = 0; i < 4; i++) {
      rows.add(
          repo.insert(p1, "같은 밀리초 " + i, "USER_ADDED", null, null, sameMs.plusNanos(i * 1_000L)));
    }
    assertThat(rows).allSatisfy(r -> assertThat(r.updatedAt().getNano() % 1_000_000).isZero());
    assertThat(rows).allSatisfy(r -> assertThat(r.createdAt().getNano() % 1_000_000).isZero());

    // 한 건씩 키셋으로 끝까지 — 커서는 밀리초(CursorCodec)를 거친다.
    List<Long> seen = new ArrayList<>();
    Row last = null;
    while (true) {
      List<Row> page = repo.page(p1, last == null ? null : cursorOf(last), 1);
      if (page.isEmpty()) break;
      last = page.get(0);
      seen.add(last.id());
    }
    assertThat(seen)
        .containsExactlyElementsOf(
            rows.stream().map(Row::id).sorted(java.util.Comparator.reverseOrder()).toList());

    // 되살린 행·고친 행도 밀리초.
    Row updated = repo.update(rows.get(0).id(), "고침", "USER_ADDED", null, sameMs.plusNanos(999));
    assertThat(updated.updatedAt().getNano() % 1_000_000).isZero();
  }

  @Test
  void 내용을_바꾸면_임베딩을_비우고_같은_내용이면_두다() {
    long uid = TestFixtures.createHuman(dsl);
    Row r = repo.insert(p1, "배포는 API 먼저", "USER_ADDED", uid, uid, t0);
    assertThat(embeddings.sharedMemoryText(r.id())).isEqualTo("배포는 API 먼저");
    embeddings.writeSharedMemory(
        r.id(), "배포는 API 먼저", TextEmbeddingRepository.vectorLiteral(embedder.expected("배포")));
    assertThat(embeddings.sharedMemoryText(r.id())).isNull();
    assertThat(embeddings.pendingSharedMemoryIds(Integer.MAX_VALUE)).doesNotContain(r.id());

    repo.update(r.id(), "배포는 API 먼저", "USER_ADDED", uid, t0.plusMinutes(1));
    assertThat(embeddings.sharedMemoryText(r.id())).isNull();

    Row changed = repo.update(r.id(), "배포는 워커 먼저", "AI_CLEANED", null, t0.plusMinutes(2));
    assertThat(changed.origin()).isEqualTo("AI_CLEANED");
    assertThat(changed.updatedBy()).isNull();
    assertThat(embeddings.pendingSharedMemoryIds(Integer.MAX_VALUE)).contains(r.id());
    assertThat(embeddings.sharedMemoryText(r.id())).isEqualTo("배포는 워커 먼저");
    // 늦게 끝난 옛 내용의 임베딩은 쓰지 않는다.
    assertThat(
            embeddings.writeSharedMemory(
                r.id(),
                "배포는 API 먼저",
                TextEmbeddingRepository.vectorLiteral(embedder.expected("배포"))))
        .isZero();
  }

  @Test
  void 원래_id_로_되살리고_쓰인_id_면_비어_있다() {
    long uid = TestFixtures.createHuman(dsl);
    Row r = repo.insert(p1, "되살릴 것", "USER_REQUESTED", uid, uid, t0);
    SharedMemorySnapshot s = SharedMemorySnapshot.of(r);
    assertThat(repo.insertWithId(r.id(), p1, s, uid, t0)).isEmpty(); // 아직 있다
    repo.delete(r.id());
    Row back = repo.insertWithId(r.id(), p1, s, uid, t0.plusMinutes(1)).orElseThrow();
    assertThat(back.id()).isEqualTo(r.id());
    assertThat(back.origin()).isEqualTo("USER_REQUESTED");
    assertThat(back.authorUserId()).isEqualTo(uid);
    // 시퀀스가 아직 발급하지 않은 id 는 되살리지 않는다(나중에 일반 저장이 키 충돌로 실패하지 않게).
    assertThat(repo.insertWithId(Long.MAX_VALUE, p1, s, uid, t0)).isEmpty();
    // 시퀀스가 되살린 id 를 다시 내주지 않는다.
    Row next = repo.insert(p1, "새것", "USER_ADDED", uid, uid, t0);
    assertThat(next.id()).isGreaterThan(r.id());
  }

  @Test
  void 스냅숏은_id_내용_출처가_같을_때만_그대로다() {
    Row r = repo.insert(p1, "원래", "AI_EXTRACTED", null, null, t0);
    SharedMemorySnapshot s = SharedMemorySnapshot.of(r);
    assertThat(s.sameAs(r)).isTrue();
    assertThat(s.sameAs(repo.update(r.id(), "원래", "AI_CLEANED", null, t0))).isFalse();
    assertThat(s.sameAs(repo.update(r.id(), "바뀜", "AI_EXTRACTED", null, t0))).isFalse();
    assertThat(s.sameAs(null)).isFalse();
  }

  @Test
  void 기록은_스냅숏_JSON_을_그대로_돌려준다() {
    long uid = TestFixtures.createHuman(dsl);
    Row r = repo.insert(p1, "합친 결과", "AI_CLEANED", null, null, t0);
    SharedMemorySnapshot before = new SharedMemorySnapshot(5L, "원본", "AI_EXTRACTED", null);
    UUID run = UUID.randomUUID();
    long id =
        changeLog.record(
            p1,
            run,
            SharedAiMemoryChangeLog.MERGED,
            null,
            r.id(),
            List.of(before),
            SharedMemorySnapshot.of(r),
            t0);
    ChangeRow row = changes.find(id).orElseThrow();
    assertThat(row.actorKind()).isEqualTo("AI");
    assertThat(row.actorUserId()).isNull();
    assertThat(row.runId()).isEqualTo(run);
    assertThat(row.spaceKey()).isEqualTo(p1);
    assertThat(changeLog.readBefore(row.beforeJson())).containsExactly(before);
    assertThat(changeLog.readAfter(row.afterJson())).isEqualTo(SharedMemorySnapshot.of(r));
    long human =
        changeLog.record(
            p1,
            null,
            SharedAiMemoryChangeLog.ADDED,
            uid,
            r.id(),
            List.of(),
            SharedMemorySnapshot.of(r),
            t0.plusMinutes(1));
    assertThat(changes.find(human).orElseThrow().actorKind()).isEqualTo("USER");
    long deleted =
        changeLog.record(
            p1,
            null,
            SharedAiMemoryChangeLog.DELETED,
            uid,
            r.id(),
            List.of(before),
            null,
            t0.plusMinutes(2));
    assertThat(changeLog.readAfter(changes.find(deleted).orElseThrow().afterJson())).isNull();
    assertThat(changes.page(p1, null, 10))
        .extracting(ChangeRow::id)
        .containsExactly(deleted, human, id);
    assertThat(changes.page(p2, null, 10)).isEmpty();
  }

  @Test
  void 기록_목록은_밀리초_커서로_끝까지_읽고_변조_커서는_첫_페이지다() {
    OffsetDateTime sameMs = t0.plusNanos(1_234_567);
    List<Long> ids = new ArrayList<>();
    for (int i = 0; i < 4; i++) {
      ids.add(
          changeLog.record(
              p1,
              null,
              SharedAiMemoryChangeLog.ADDED,
              null,
              100 + i,
              List.of(),
              null,
              sameMs.plusNanos(i * 1_000L)));
    }
    assertThat(changes.find(ids.get(0)).orElseThrow().createdAt().getNano() % 1_000_000).isZero();

    List<Long> seen = new ArrayList<>();
    CursorCodec.Decoded cursor = null;
    while (true) {
      List<ChangeRow> page = changes.page(p1, cursor, 1);
      if (page.isEmpty()) break;
      ChangeRow last = page.get(0);
      seen.add(last.id());
      cursor = CursorCodec.decode(CursorCodec.encode(last.createdAt(), Long.toString(last.id())));
    }
    assertThat(seen).containsExactly(ids.get(3), ids.get(2), ids.get(1), ids.get(0));
    // 숫자가 아닌 커서 id(세션 UUID 커서 등)는 500 이 아니라 첫 페이지.
    assertThat(changes.page(p1, new CursorCodec.Decoded(Instant.now(), "not-a-number"), 10))
        .hasSize(4);
  }

  @Test
  void 기록_되돌림_표시와_보관_정리() {
    long uid = TestFixtures.createHuman(dsl);
    long id =
        changeLog.record(p1, null, SharedAiMemoryChangeLog.ADDED, null, 1, List.of(), null, t0);
    assertThat(changes.lock(id)).isPresent();
    assertThat(changes.markUndone(id, uid, t0.plusDays(1))).isEqualTo(1);
    assertThat(changes.markUndone(id, uid, t0.plusDays(2))).isZero();
    ChangeRow done = changes.find(id).orElseThrow();
    assertThat(done.undoneBy()).isEqualTo(uid);
    assertThat(done.undoneAt()).isNotNull();
    // 2026-10-15 의 기록은 아주 먼 옛날 기준으로는 지워지지 않고, 이 기록만 지나는 시각 기준으로는 지워진다.
    assertThat(changes.deleteOlderThan(t0.minusYears(100))).isZero();
    assertThat(changes.deleteOlderThan(t0.plusSeconds(1))).isGreaterThanOrEqualTo(1);
    assertThat(changes.find(id)).isEmpty();
  }

  @Test
  void 검색_순위_재료는_키워드와_거리를_공간_안에서만_돌려준다() {
    Row hit = repo.insert(p1, "배포는 API 먼저 한다", "USER_ADDED", null, null, t0);
    Row miss = repo.insert(p1, "점심은 12시", "USER_ADDED", null, null, t0.plusMinutes(1));
    repo.insert(p2, "배포는 다른 공간", "USER_ADDED", null, null, t0);
    embeddings.writeSharedMemory(
        hit.id(),
        hit.content(),
        TextEmbeddingRepository.vectorLiteral(embedder.expected("배포는 API 먼저 한다")));

    var scored = repo.score(p1, "배포는", SearchTerms.of("배포는"), embedder.expected("배포는 API 먼저 한다"));
    assertThat(scored).hasSize(2);
    var h = scored.stream().filter(s -> s.row().id() == hit.id()).findFirst().orElseThrow();
    var m = scored.stream().filter(s -> s.row().id() == miss.id()).findFirst().orElseThrow();
    assertThat(h.ftsMatch()).isTrue();
    assertThat(h.termHits()).isPositive();
    assertThat(h.distance()).isNotNull().isLessThan(0.01);
    assertThat(m.ftsMatch()).isFalse();
    assertThat(m.termHits()).isZero();
    assertThat(m.distance()).isNull(); // 임베딩이 아직 빈 행은 의미 미스
    // 질의 임베딩이 없으면 거리 재료를 뺀다.
    assertThat(repo.score(p1, "배포는", SearchTerms.of("배포는"), null))
        .allSatisfy(s -> assertThat(s.distance()).isNull());
  }

  @Test
  void 지운_기록은_공간마다_정규화로_막고_다시_말하면_풀린다() {
    forgotten.remember(p1, List.of("배포는 금요일에 하지 않는다!"));
    assertThat(forgotten.isForgotten(p1, "배포는 금요일에 하지 않는다", null)).isTrue();
    assertThat(forgotten.isForgotten(p2, "배포는 금요일에 하지 않는다", null)).isFalse();
    forgotten.release(p1, "배포는  금요일에 하지 않는다");
    assertThat(forgotten.isForgotten(p1, "배포는 금요일에 하지 않는다", null)).isFalse();
  }

  @Test
  void 지운_기록은_의미가_가까우면_막는다() {
    embedder.synonyms(List.of(List.of("금요일", "주말전")));
    forgotten.remember(p1, List.of("금요일 배포 금지"));
    var row =
        dsl.select(SHARED_AI_MEMORY_FORGOTTEN.ID, SHARED_AI_MEMORY_FORGOTTEN.CONTENT)
            .from(SHARED_AI_MEMORY_FORGOTTEN)
            .where(SHARED_AI_MEMORY_FORGOTTEN.SPACE_TYPE.eq("PROJECT"))
            .and(SHARED_AI_MEMORY_FORGOTTEN.SPACE_ID.eq(base))
            .fetchOne();
    assertThat(embeddings.sharedForgottenText(row.value1())).isEqualTo("금요일 배포 금지");
    embeddings.writeSharedForgotten(
        row.value1(),
        row.value2(),
        TextEmbeddingRepository.vectorLiteral(embedder.expected("금요일 배포 금지")));
    assertThat(embeddings.sharedForgottenText(row.value1())).isNull();
    assertThat(embeddings.pendingSharedForgottenIds(Integer.MAX_VALUE))
        .doesNotContain(row.value1());
    assertThat(forgotten.isForgotten(p1, "주말전 배포 금지", embedder.expected("주말전 배포 금지"))).isTrue();
    // 다른 공간은 같은 뜻이어도 막지 않는다.
    assertThat(forgotten.isForgotten(p2, "주말전 배포 금지", embedder.expected("주말전 배포 금지"))).isFalse();
  }

  @Test
  void 지운_기록은_공간당_300행을_넘지_않는다() {
    List<String> many = new ArrayList<>();
    for (int i = 0; i < 305; i++) many.add("규칙 " + i);
    forgotten.remember(p1, many);
    assertThat(forgottenRepo.contents(p1)).hasSize(SharedAiMemoryForgottenRepository.SPACE_CAP);
    assertThat(forgottenRepo.contents(p1).get(0)).isEqualTo("규칙 5");
    // 한 번에 상한을 넘게 오면 뒤쪽만 넣고, 이어서 넣으면 오래된 것부터 밀린다.
    forgotten.remember(p1, List.of("뒤에 온 규칙"));
    assertThat(forgottenRepo.contents(p1)).hasSize(SharedAiMemoryForgottenRepository.SPACE_CAP);
    assertThat(forgottenRepo.contents(p1).get(0)).isEqualTo("규칙 6");
    assertThat(forgottenRepo.contents(p1)).endsWith("뒤에 온 규칙");
    // 다른 공간은 건드리지 않는다.
    assertThat(forgottenRepo.contents(p2)).isEmpty();
  }

  @Test
  void 공간을_지우면_메모리_기록_지운_기록이_모두_사라진다() {
    long uid = TestFixtures.createHuman(dsl);
    Row r = repo.insert(p1, "지울 공간", "USER_ADDED", uid, uid, t0);
    changeLog.record(
        p1,
        null,
        SharedAiMemoryChangeLog.ADDED,
        uid,
        r.id(),
        List.of(),
        SharedMemorySnapshot.of(r),
        t0);
    forgotten.remember(p1, List.of("잊은 것"));
    repo.insert(p2, "남을 공간", "USER_ADDED", uid, uid, t0);
    forgotten.remember(p2, List.of("남을 기록"));
    repo.deleteSpace(p1);
    assertThat(repo.count(p1)).isZero();
    assertThat(changes.page(p1, null, 10)).isEmpty();
    assertThat(forgottenRepo.contents(p1)).isEmpty();
    assertThat(repo.count(p2)).isEqualTo(1);
    assertThat(forgottenRepo.contents(p2)).containsExactly("남을 기록");
  }

  @Test
  void 사용자_이름을_모아_읽는다() {
    long uid = TestFixtures.createHuman(dsl);
    assertThat(repo.userNames(List.of(uid))).containsKey(uid);
    assertThat(repo.userNames(List.of())).isEmpty();
  }

  /** 이 트랜잭션이 잡은 advisory lock 수 — pg_locks 의 (classid, objid). 2-int 잠금은 objsubid=2 다. */
  private int heldAdvisory(int classId, int key) {
    return dsl.fetchOne(
            "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND granted"
                + " AND pid = pg_backend_pid() AND objsubid = 2 AND classid = ?::oid AND objid = ?::oid",
            classId,
            key)
        .get(0, Integer.class);
  }

  @Test
  void 공간_잠금은_종류마다_다른_키로_잡히고_같은_트랜잭션에서_다시_잡아도_된다() {
    long tenant = TenantContext.require();
    SpaceKey wiki = SpaceKey.of("WIKI_SPACE", base);
    assertThat(heldAdvisory(3861, (int) base)).isZero();
    repo.lockSpace(p1);
    repo.lockSpace(p1);
    repo.lockSpace(org);
    repo.lockSpace(wiki);
    assertThat(heldAdvisory(3861, (int) base)).isEqualTo(1);
    // 조직 잠금 키는 테넌트 id — 다른 테넌트의 조직 변경과 줄 서지 않는다.
    assertThat(heldAdvisory(3860, (int) tenant)).isEqualTo(1);
    assertThat(heldAdvisory(3860, 0)).isZero();
    assertThat(heldAdvisory(3862, (int) base)).isEqualTo(1);
    assertThat(heldAdvisory(3861, (int) base + 1)).isZero(); // p2 는 잡지 않았다
  }
}
