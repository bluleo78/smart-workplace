package com.workplace.home.service;

import static com.workplace.jooq.Tables.AI_MEMORY;
import static com.workplace.jooq.Tables.HOME_SESSION;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.service.AssistantSpec;
import com.workplace.home.AiMemoryTestFixtures;
import com.workplace.home.dto.AiMemoryItem;
import com.workplace.home.dto.CreateAiMemoryRequest;
import com.workplace.home.dto.UndoAiMemoryRequest;
import com.workplace.home.dto.UpdateAiMemoryRequest;
import com.workplace.home.outbound.MemoryCleanupMessages.Op;
import com.workplace.home.repository.AiMemoryChangeRepository;
import com.workplace.home.repository.AiMemoryChangeRepository.ChangeRow;
import com.workplace.home.repository.AiMemoryForgottenRepository;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.NewMemory;
import com.workplace.home.repository.AiMemoryRepository.Row;
import com.workplace.home.repository.TextEmbeddingRepository;
import com.workplace.home.service.SessionCleanupInput.Utterance;
import com.workplace.support.FakeTextEmbedder;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.service.AiPreferenceService;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-385 스펙 5.4·5.5 — op 적용(ADD·UPDATE·MERGE·FORGET), 사용자 저장분·고정분 보호, 입력 밖 id·evidence 범위, 지운
 * 기록(정규화·임베딩)으로 ADD 막기, 수집 뒤 바뀐 대상은 물러서기, 틀린 op 하나가 회차 전체를 망치지 않기, 한도, 꺼짐, 경계 경합. 적용기가 바깥(테스트)
 * 트랜잭션에 참여하므로 롤백된다.
 */
@Transactional
class AiMemoryCleanupApplyTest extends IntegrationTestBase {

  private static final AssistantSpec SPEC =
      new AssistantSpec(1L, "claude-sonnet-5-5", "NORMAL", 8, 60_000);

  @Autowired DSLContext dsl;
  @Autowired AiMemoryCleanupApplier applier;
  @Autowired AiMemoryRepository repo;
  @Autowired AiMemoryService service;
  @Autowired AiMemoryUndoService undoService;
  @Autowired HomeSessionService sessions;
  @Autowired AiMemoryChangeRepository changeRepo;
  @Autowired AiMemoryChangeLog changeLog;
  @Autowired AiMemoryChangeService changeService;
  @Autowired AiMemoryForgottenRepository forgottenRepo;
  @Autowired TextEmbeddingRepository embeddings;
  @Autowired AiPreferenceService preferences;
  @Autowired FakeTextEmbedder fake;

  private long uid;
  private UUID sid;
  private long first;
  private long upto;

  @BeforeEach
  void setUp() {
    fake.reset();
    uid = TestFixtures.createHuman(dsl);
    sid = sessions.create(uid).id();
    first = sessions.appendMessage(uid, sid, "USER", "나 이번 분기부터 WP 배포를 맡았어", null, null, null);
    upto = sessions.appendMessage(uid, sid, "USER", "보고서랑 요약은 표로 정리해 줘", null, null, null);
  }

  private Row ai(String content) {
    return repo.insert(uid, new NewMemory("PREFERENCE", content, "AI", null, null, null));
  }

  private Row userMemory(String content) {
    return repo.insert(uid, new NewMemory("PREFERENCE", content, "USER", null, null, null));
  }

  /** 기존 테스트용 — 구간 마지막 메시지 시각을 먼 미래로 둬 「대화 뒤에 고친 메모리」 판정이 끼지 않게 한다(DB·앱 시계 차이와 무관). */
  private SessionCleanupInput input(List<Row> memories) {
    return input(memories, Instant.now().plus(3650, ChronoUnit.DAYS), Set.of());
  }

  private SessionCleanupInput input(
      List<Row> memories, Instant lastMessageAt, Set<Long> protectedIds) {
    return new SessionCleanupInput(
        1L,
        uid,
        sid,
        null,
        upto,
        List.of(
            new Utterance(first, "나 이번 분기부터 WP 배포를 맡았어"), new Utterance(upto, "보고서랑 요약은 표로 정리해 줘")),
        List.of(),
        memories,
        SPEC,
        LocalDate.now(AiMemoryClock.ZONE),
        lastMessageAt,
        protectedIds);
  }

  /** 메모리 수정 시각을 직접 둔다(대화 뒤·수집 전에 고친 것 흉내) — 바뀐 행을 다시 읽어 돌려준다(수집 때의 행). */
  private Row touchedAt(long id, Instant at, UUID sourceSession) {
    dsl.update(AI_MEMORY)
        .set(AI_MEMORY.UPDATED_AT, at.atOffset(ZoneOffset.UTC))
        .set(AI_MEMORY.SOURCE_SESSION_ID, sourceSession)
        .where(AI_MEMORY.ID.eq(id))
        .execute();
    return find(id).orElseThrow();
  }

  private boolean apply(List<Row> memories, Op... ops) {
    return applier.apply(input(memories), List.of(ops), Map.of(), List.of());
  }

  private static Op add(String content, String kind, Integer evidence) {
    return new Op("ADD", null, content, kind, null, null, evidence, "새로 알게 됨");
  }

  private static Op update(long id, String content, int evidence) {
    return new Op("UPDATE", List.of(id), content, "PREFERENCE", null, null, evidence, "고침");
  }

  private static Op merge(List<Long> ids, String content, int evidence) {
    return new Op("MERGE", ids, content, "PREFERENCE", null, null, evidence, "같은 주제");
  }

  private static Op forget(long id, int evidence) {
    return new Op("FORGET", List.of(id), null, null, null, null, evidence, "대화와 맞지 않음");
  }

  private List<Row> all() {
    return AiMemoryTestFixtures.allMemories(dsl, uid);
  }

  private Optional<Row> find(long id) {
    return all().stream().filter(r -> r.id() == id).findFirst();
  }

  private List<ChangeRow> changes() {
    return changeRepo.page(uid, null, 50);
  }

  private Long processed() {
    return dsl.select(HOME_SESSION.MEMORY_PROCESSED_MESSAGE_ID)
        .from(HOME_SESSION)
        .where(HOME_SESSION.ID.eq(sid))
        .fetchOne(HOME_SESSION.MEMORY_PROCESSED_MESSAGE_ID);
  }

  @Test
  void ADD_는_AI_출처와_이_대화와_지금_사용_시각으로_저장하고_ADDED_를_남긴다() {
    assertThat(apply(List.of(), add("WP 프로젝트 배포 일을 맡고 있다", "CONTEXT", 0))).isTrue();

    Row r = all().get(0);
    assertThat(r.content()).isEqualTo("WP 프로젝트 배포 일을 맡고 있다");
    assertThat(r.kind()).isEqualTo("CONTEXT");
    assertThat(r.source()).isEqualTo("AI");
    assertThat(r.sourceSessionId()).isEqualTo(sid);
    assertThat(r.lastUsedAt()).isAfter(Instant.now().minusSeconds(60));
    ChangeRow c = changes().get(0);
    assertThat(c.action()).isEqualTo("ADDED");
    assertThat(c.memoryId()).isEqualTo(r.id());
    assertThat(changeLog.readBefore(c.beforeJson())).isEmpty();
    assertThat(changeLog.readAfter(c.afterJson()).sameAs(r)).isTrue();
    assertThat(c.sourceSessionId()).isEqualTo(sid);
    assertThat(c.reason()).isEqualTo("새로 알게 됨");
    assertThat(processed()).isEqualTo(upto);
  }

  @Test
  void UPDATE_는_내용을_바꾸고_이전_스냅숏을_남긴다() {
    Row m = ai("아침 회의는 9시");

    apply(List.of(m), update(m.id(), "아침 회의는 10시", 1));

    Row now = find(m.id()).orElseThrow();
    assertThat(now.content()).isEqualTo("아침 회의는 10시");
    assertThat(now.sourceSessionId()).isEqualTo(sid);
    ChangeRow c = changes().get(0);
    assertThat(c.action()).isEqualTo("UPDATED");
    assertThat(changeLog.readBefore(c.beforeJson()))
        .extracting(MemorySnapshot::content)
        .containsExactly("아침 회의는 9시");
  }

  @Test
  void MERGE_는_첫_대상을_남겨_고치고_나머지를_지우며_지운_기록에_넣지_않는다() {
    Row a = ai("주간 보고서는 표로");
    Row b = ai("요약은 표 형식 선호");

    apply(List.of(a, b), merge(List.of(a.id(), b.id()), "보고서·요약은 표로 정리한다", 1));

    assertThat(find(a.id()).orElseThrow().content()).isEqualTo("보고서·요약은 표로 정리한다");
    assertThat(find(b.id())).isEmpty();
    ChangeRow c = changes().get(0);
    assertThat(c.action()).isEqualTo("MERGED");
    assertThat(c.memoryId()).isEqualTo(a.id());
    assertThat(changeLog.readBefore(c.beforeJson()))
        .extracting(MemorySnapshot::id)
        .containsExactly(a.id(), b.id());
    assertThat(AiMemoryTestFixtures.forgottenContents(dsl, uid)).isEmpty();
  }

  @Test
  void FORGET_은_지우고_FORGOTTEN_을_남기며_지운_기록에_넣지_않는다() {
    Row m = ai("회의록은 영어로 쓴다");

    apply(List.of(m), forget(m.id(), 1));

    assertThat(find(m.id())).isEmpty();
    ChangeRow c = changes().get(0);
    assertThat(c.action()).isEqualTo("FORGOTTEN");
    assertThat(c.afterJson()).isNull();
    assertThat(AiMemoryTestFixtures.forgottenContents(dsl, uid)).isEmpty();
  }

  @Test
  void 사용자_저장분과_고정분이_끼면_그_op_만_버린다() {
    Row mine = userMemory("답은 존댓말로 한다");
    Row pinned = repo.setPinned(uid, ai("메일은 짧게 쓴다").id(), true).orElseThrow();
    Row plain = ai("이슈 목록은 표로");

    apply(
        List.of(mine, pinned, plain),
        update(mine.id(), "답은 반말로 한다", 0),
        forget(pinned.id(), 0),
        merge(List.of(plain.id(), pinned.id()), "합친 것", 0),
        forget(plain.id(), 0));

    assertThat(find(mine.id()).orElseThrow().content()).isEqualTo("답은 존댓말로 한다");
    assertThat(find(pinned.id())).isPresent();
    assertThat(find(plain.id())).isEmpty();
    assertThat(changes()).extracting(ChangeRow::action).containsExactly("FORGOTTEN");
  }

  @Test
  void 입력으로_주지_않은_id_나_evidence_가_범위_밖이면_버린다() {
    Row given = ai("a");
    Row notGiven = ai("b");

    apply(
        List.of(given),
        update(notGiven.id(), "b2", 0),
        update(given.id(), "a2", 2),
        add("새 것", "CONTEXT", -1),
        add("새 것 둘", "CONTEXT", null));

    assertThat(find(given.id()).orElseThrow().content()).isEqualTo("a");
    assertThat(find(notGiven.id()).orElseThrow().content()).isEqualTo("b");
    assertThat(all()).hasSize(2);
    assertThat(changes()).isEmpty();
    assertThat(processed()).isEqualTo(upto);
  }

  @Test
  void 지운_기록과_정규화가_같거나_임베딩이_가까우면_ADD_를_버린다() {
    List<Long> ids = forgottenRepo.insertAll(uid, List.of("보고서는 표로!", "고양이를 좋아한다"));
    embeddings.writeForgotten(
        ids.get(1), "고양이를 좋아한다", TextEmbeddingRepository.vectorLiteral(fake.expected("고양이를 좋아한다")));

    applier.apply(
        input(List.of()),
        List.of(
            add("보고서는 표로", "PREFERENCE", 1),
            add("냥이를 아주 좋아함", "PREFERENCE", 0),
            add("메일은 세 줄로 요약한다", "PREFERENCE", 0)),
        Map.of("냥이를 아주 좋아함", fake.expected("고양이를 좋아한다")),
        List.of());

    assertThat(all()).extracting(Row::content).containsExactly("메일은 세 줄로 요약한다");
  }

  @Test
  void 결과_줄에서_되돌린_저장은_정리가_다시_ADD_하지_못한다() {
    AiMemoryItem m =
        service.create(
            uid,
            new CreateAiMemoryRequest("CONTEXT", "WP 프로젝트 배포 일을 맡고 있다", "AI", sid, null, null),
            true);
    long messageId =
        AiMemoryTestFixtures.assistantMessageWithMemory(
            sessions,
            uid,
            AiMemoryTestFixtures.memoryBlock("saved", m.id(), "CONTEXT", m.content(), null, "AI"));
    undoService.undo(uid, new UndoAiMemoryRequest(messageId, 0));

    apply(List.of(), add("WP 프로젝트 배포 일을 맡고 있다", "CONTEXT", 0));

    assertThat(all()).isEmpty();
  }

  @Test
  void 입력_수집_뒤에_바뀐_대상은_건드리지_않는다() {
    Row seen = ai("아침 회의는 9시");
    UpdateAiMemoryRequest edit = new UpdateAiMemoryRequest();
    edit.setContent("아침 회의는 9시 반");
    service.update(uid, seen.id(), edit, false);
    assertThat(find(seen.id()).orElseThrow().updatedAt()).isNotEqualTo(seen.updatedAt());
    Row pinnedLater = ai("메일은 짧게 쓴다");
    repo.setPinned(uid, pinnedLater.id(), true);

    apply(
        List.of(seen, pinnedLater),
        update(seen.id(), "아침 회의는 10시", 0),
        forget(pinnedLater.id(), 0));

    assertThat(find(seen.id()).orElseThrow().content()).isEqualTo("아침 회의는 9시 반");
    assertThat(find(pinnedLater.id())).isPresent();
    assertThat(changes()).isEmpty();
  }

  @Test
  void 틀린_op_하나가_있어도_나머지는_적용되고_경계가_오른다() {
    Row mine = userMemory("답은 존댓말로 한다");

    boolean marked =
        apply(
            List.of(mine),
            add("x".repeat(301), "PREFERENCE", 0),
            new Op("ADD", null, "범위가 틀림", "PREFERENCE", "FOO", null, 0, "r"),
            new Op("ADD", null, "지난 기한", "PREFERENCE", null, "2020-01-01", 0, "r"),
            new Op("ADD", null, "종류가 틀림", "WRONG", null, null, 0, "r"),
            new Op("ADD", null, "종류 없음", null, null, null, 0, "r"),
            new Op("RENAME", List.of(mine.id()), "모르는 op", null, null, null, 0, "r"),
            update(mine.id(), "반말", 0),
            add("메일은 세 줄로 요약한다", "PREFERENCE", 1));

    assertThat(marked).isTrue();
    assertThat(processed()).isEqualTo(upto);
    assertThat(all())
        .extracting(Row::content)
        .containsExactlyInAnyOrder("답은 존댓말로 한다", "메일은 세 줄로 요약한다");
    assertThat(changes()).hasSize(1);
  }

  @Test
  void 범위가_가득이면_그_범위_ADD_만_버린다() {
    AiMemoryTestFixtures.fill(dsl, uid, null, AiMemoryService.LIMIT);

    applier.apply(
        input(List.of()),
        List.of(
            add("공통은 가득", "PREFERENCE", 0),
            new Op("ADD", null, "메일 답장은 짧게", "PREFERENCE", "MAIL", null, 0, "r")),
        Map.of(),
        List.of());

    assertThat(all()).extracting(Row::content).contains("메일 답장은 짧게").doesNotContain("공통은 가득");
  }

  @Test
  void 적용_시점에_메모리를_꺼_두었으면_전부_버리고_처리_완료로_둔다() {
    preferences.update(uid, null, false);

    assertThat(apply(List.of(), add("WP 배포를 맡고 있다", "CONTEXT", 0))).isTrue();

    assertThat(all()).isEmpty();
    assertThat(processed()).isEqualTo(upto);
  }

  @Test
  void 다른_회차가_경계를_이미_올렸으면_아무것도_하지_않는다() {
    dsl.update(HOME_SESSION)
        .set(HOME_SESSION.MEMORY_PROCESSED_MESSAGE_ID, upto)
        .where(HOME_SESSION.ID.eq(sid))
        .execute();

    assertThat(apply(List.of(), add("WP 배포를 맡고 있다", "CONTEXT", 0))).isFalse();

    assertThat(all()).isEmpty();
  }

  @Test
  void 같은_회차에_같은_대상을_두_번_고르거나_같은_문장을_두_번_ADD_하면_뒤의_것을_버린다() {
    Row m = ai("a");

    apply(
        List.of(m),
        update(m.id(), "b", 0),
        forget(m.id(), 0),
        add("새 문장", "PREFERENCE", 0),
        add("새 문장!", "PREFERENCE", 1));

    assertThat(find(m.id()).orElseThrow().content()).isEqualTo("b");
    assertThat(all()).extracting(Row::content).containsExactlyInAnyOrder("b", "새 문장");
  }

  // 최종 리뷰 3: 대화가 끝난 뒤·입력 수집 전에 설정이나 다른 대화에서 고친 메모리는 이 대화가 근거가 될 수 없다.
  @Test
  void 대화_뒤_수집_전에_다른_경로로_고친_대상은_건드리지_않는다() {
    Instant last = Instant.parse("2026-10-15T00:00:00Z");
    Row editedInSettings = touchedAt(ai("아침 회의는 9시").id(), last.plus(2, ChronoUnit.HOURS), null);
    UUID other = sessions.create(uid).id();
    Row editedElsewhere = touchedAt(ai("메일은 짧게").id(), last.plus(1, ChronoUnit.HOURS), other);
    // 이 대화의 앞선 정리 회차가 쓴 결과(기록의 after 가 지금 행과 그대로) — 이 대화 자신의 고침이라 대상으로 남는다.
    Row byThisSession = touchedAt(ai("이슈 목록은 표로").id(), last.plus(1, ChronoUnit.HOURS), sid);
    changeLog.record(
        uid,
        UUID.randomUUID(),
        AiMemoryChangeAction.ADDED,
        byThisSession.id(),
        List.of(),
        MemorySnapshot.of(byThisSession),
        sid,
        "앞선 회차",
        last.plus(1, ChronoUnit.HOURS).atOffset(ZoneOffset.UTC));
    Row before = touchedAt(ai("회의록은 영어로").id(), last.minus(1, ChronoUnit.HOURS), null);

    applier.apply(
        input(List.of(editedInSettings, editedElsewhere, byThisSession, before), last, Set.of()),
        List.of(
            update(editedInSettings.id(), "아침 회의는 10시", 0),
            forget(editedElsewhere.id(), 0),
            update(byThisSession.id(), "이슈 목록은 짧은 표로", 1),
            forget(before.id(), 1)),
        Map.of(),
        List.of());

    assertThat(find(editedInSettings.id()).orElseThrow().content()).isEqualTo("아침 회의는 9시");
    assertThat(find(editedElsewhere.id())).isPresent();
    assertThat(find(byThisSession.id()).orElseThrow().content()).isEqualTo("이슈 목록은 짧은 표로");
    assertThat(find(before.id())).isEmpty();
    assertThat(changes())
        .extracting(ChangeRow::action)
        .containsExactlyInAnyOrder("ADDED", "UPDATED", "FORGOTTEN");
  }

  // 이 대화가 저장한 메모리(출처 = 이 대화)라도 대화가 끝난 뒤 사용자가 설정에서 고쳤으면 그 고침을 덮지 않는다 — 출처만으로는 가를 수 없다.
  @Test
  void 이_대화가_저장한_메모리를_대화_뒤에_설정에서_고쳤으면_건드리지_않는다() {
    AiMemoryItem saved =
        service.create(
            uid, new CreateAiMemoryRequest("PREFERENCE", "아침 회의는 9시", "AI", sid, null, null), true);
    Instant last = Instant.now().minus(1, ChronoUnit.HOURS);
    UpdateAiMemoryRequest edit = new UpdateAiMemoryRequest();
    edit.setContent("아침 회의는 9시 반");
    service.update(uid, saved.id(), edit, false);
    Row seen = find(saved.id()).orElseThrow();
    assertThat(seen.sourceSessionId()).isEqualTo(sid);

    applier.apply(
        input(List.of(seen), last, Set.of()),
        List.of(update(saved.id(), "아침 회의는 10시", 0)),
        Map.of(),
        List.of());

    assertThat(find(saved.id()).orElseThrow().content()).isEqualTo("아침 회의는 9시 반");
    assertThat(changes()).isEmpty();
  }

  // 최종 리뷰 2(b): 사용자가 이 구간 결과 줄에서 되돌린 메모리(보호 id)는 고치지도 지우지도 합치지도 않는다.
  @Test
  void 보호_id_는_대상에서_버린다() {
    Row kept = ai("아침 회의는 9시");
    Row other = ai("메일은 짧게");

    applier.apply(
        input(List.of(kept, other), Instant.now().plus(1, ChronoUnit.DAYS), Set.of(kept.id())),
        List.of(
            update(kept.id(), "아침 회의는 10시", 0),
            forget(kept.id(), 0),
            merge(List.of(other.id(), kept.id()), "합친 것", 0),
            forget(other.id(), 1)),
        Map.of(),
        List.of());

    assertThat(find(kept.id()).orElseThrow().content()).isEqualTo("아침 회의는 9시");
    assertThat(find(other.id())).isEmpty();
    assertThat(changes()).extracting(ChangeRow::action).containsExactly("FORGOTTEN");
  }

  // 최종 리뷰 2(a): 결과 줄 「고침」을 되돌리면 거절한 새 내용이 지운 기록에 남아, 같은 대화를 다시 읽는 정리가 같은 고침을 다시 하지 못한다.
  @Test
  void 결과_줄에서_되돌린_고침은_정리가_다시_같은_내용으로_고치지_못한다() {
    AiMemoryItem m =
        service.create(
            uid, new CreateAiMemoryRequest("PREFERENCE", "아침 회의는 9시", "AI", sid, null, null), true);
    UpdateAiMemoryRequest edit = new UpdateAiMemoryRequest();
    edit.setContent("아침 회의는 10시");
    service.update(uid, m.id(), edit, true);
    long messageId =
        AiMemoryTestFixtures.assistantMessageWithMemory(
            sessions,
            uid,
            AiMemoryTestFixtures.memoryBlock(
                "updated", m.id(), "PREFERENCE", "아침 회의는 10시", "아침 회의는 9시", "AI"));
    undoService.undo(uid, new UndoAiMemoryRequest(messageId, 0));
    assertThat(AiMemoryTestFixtures.forgottenContents(dsl, uid)).contains("아침 회의는 10시");
    Row restored = find(m.id()).orElseThrow();

    apply(List.of(restored), update(m.id(), "아침 회의는 10시", 0));

    assertThat(find(m.id()).orElseThrow().content()).isEqualTo("아침 회의는 9시");
    assertThat(changes()).isEmpty();
  }

  // 최종 리뷰 10: 이미 있는 메모리나 같은 회차의 앞선 고침·합침 결과와 같은 문장을 새로 기억하면 중복이다.
  @Test
  void 입력_메모리나_앞선_고침_결과와_같은_문장의_ADD_는_버린다() {
    Row existing = ai("보고서는 표로 정리한다");
    Row old = ai("아침 회의는 9시");

    apply(
        List.of(existing, old),
        add("보고서는 표로 정리한다!", "PREFERENCE", 0),
        update(old.id(), "아침 회의는 10시", 0),
        add("아침 회의는 10시", "CONTEXT", 1),
        add("메일은 세 줄로 요약한다", "PREFERENCE", 1));

    assertThat(all())
        .extracting(Row::content)
        .containsExactlyInAnyOrder("보고서는 표로 정리한다", "아침 회의는 10시", "메일은 세 줄로 요약한다");
    assertThat(changes())
        .extracting(ChangeRow::action)
        .containsExactlyInAnyOrder("UPDATED", "ADDED");
  }

  // 코드 리뷰 5: 고침·합침 결과도 다른 입력 메모리나 같은 회차의 앞선 결과와 같은 문장이면 중복이라 버린다(대상 자신의 지금 문장은 빼고 본다).
  @Test
  void 다른_메모리나_앞선_결과와_같은_문장으로_고치거나_합치면_버리고_대상_자신의_문장으로_합치면_적용한다() {
    Row existing = ai("보고서는 표로 정리한다");
    Row toDup = ai("아침 회의는 9시");
    Row afterAdd = ai("메일은 길게");
    Row a = ai("주간 보고서는 표로");
    Row b = ai("요약은 표 형식 선호");

    apply(
        List.of(existing, toDup, afterAdd, a, b),
        update(toDup.id(), "보고서는 표로 정리한다!", 0),
        add("메일은 세 줄로 요약한다", "PREFERENCE", 1),
        update(afterAdd.id(), "메일은 세 줄로 요약한다", 1),
        merge(List.of(a.id(), b.id()), "요약은 표 형식 선호", 1));

    assertThat(find(toDup.id()).orElseThrow().content()).isEqualTo("아침 회의는 9시");
    assertThat(find(afterAdd.id()).orElseThrow().content()).isEqualTo("메일은 길게");
    assertThat(find(a.id()).orElseThrow().content()).isEqualTo("요약은 표 형식 선호");
    assertThat(find(b.id())).isEmpty();
    assertThat(changes())
        .extracting(ChangeRow::action)
        .containsExactlyInAnyOrder("ADDED", "MERGED");
  }

  // 코드 리뷰 10: 같은 대화의 정리가 새로 기억(ADDED)한 뒤 고친(UPDATED) 메모리를 사용자가 대화 뒤 기록 화면에서 고침만 되돌리면, 지금 행이 앞선
  // ADDED 결과와 그대로라도 대화 뒤에 사용자가 바꾼 것이다 — 다음 회차가 다시 고치지 않는다.
  @Test
  void 대화_뒤에_기록_화면에서_되돌린_메모리는_앞선_정리_결과와_그대로여도_건드리지_않는다() {
    Row m = repo.insert(uid, new NewMemory("PREFERENCE", "아침 회의는 9시", "AI", sid, null, null));
    changeLog.record(
        uid,
        UUID.randomUUID(),
        AiMemoryChangeAction.ADDED,
        m.id(),
        List.of(),
        MemorySnapshot.of(m),
        sid,
        "앞선 회차",
        Instant.now().minus(2, ChronoUnit.HOURS).atOffset(ZoneOffset.UTC));
    apply(List.of(m), update(m.id(), "아침 회의는 10시", 0));
    ChangeRow updated = changes().get(0);
    assertThat(updated.action()).isEqualTo("UPDATED");
    changeService.undo(uid, updated.id(), false);
    Row restored = find(m.id()).orElseThrow();
    assertThat(restored.content()).isEqualTo("아침 회의는 9시");
    // 다음 회차 — 경계를 처음으로 돌리고, 구간 마지막 메시지는 되돌리기보다 앞이다.
    dsl.update(HOME_SESSION)
        .setNull(HOME_SESSION.MEMORY_PROCESSED_MESSAGE_ID)
        .where(HOME_SESSION.ID.eq(sid))
        .execute();

    applier.apply(
        input(List.of(restored), Instant.now().minus(1, ChronoUnit.HOURS), Set.of()),
        List.of(update(m.id(), "아침 회의는 9시 반", 1)),
        Map.of(),
        List.of());

    assertThat(find(m.id()).orElseThrow().content()).isEqualTo("아침 회의는 9시");
    assertThat(changes()).hasSize(2);
  }

  // 최종 리뷰 11: 결과가 지금 행과 그대로인 고침은 아무것도 바꾸지 않으니 기록·출처·시각을 건드리지 않는다.
  @Test
  void 결과가_지금과_같은_UPDATE_는_기록하지_않고_건너뛴다() {
    Row m = ai("아침 회의는 9시");

    apply(List.of(m), update(m.id(), "아침 회의는 9시", 0));

    Row now = find(m.id()).orElseThrow();
    assertThat(now.updatedAt()).isEqualTo(m.updatedAt());
    assertThat(now.sourceSessionId()).isNull();
    assertThat(changes()).isEmpty();
  }

  // 최종 리뷰 7: AI 내용·사유의 NUL 은 Postgres 가 받지 않는다 — 한 op 가 적용 트랜잭션 전체를 깨지 않게 서버에서도 지운다.
  @Test
  void 내용과_사유의_NUL_은_지우고_적용하며_다른_op_도_적용된다() {
    boolean marked =
        apply(
            List.of(),
            new Op("ADD", null, "배포\u0000 일을 맡고 있다", "CONTEXT", null, null, 0, "맡은\u0000 일"),
            add("메일은 세 줄로 요약한다", "PREFERENCE", 1));

    assertThat(marked).isTrue();
    assertThat(all())
        .extracting(Row::content)
        .containsExactlyInAnyOrder("배포 일을 맡고 있다", "메일은 세 줄로 요약한다");
    assertThat(changes()).extracting(ChangeRow::reason).contains("맡은 일");
    assertThat(processed()).isEqualTo(upto);
  }
}
