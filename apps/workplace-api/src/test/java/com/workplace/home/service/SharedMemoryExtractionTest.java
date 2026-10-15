package com.workplace.home.service;

import static com.workplace.home.SharedMemoryFixtures.addProjectMember;
import static com.workplace.home.SharedMemoryFixtures.addWikiMember;
import static com.workplace.home.SharedMemoryFixtures.project;
import static com.workplace.home.SharedMemoryFixtures.teamWiki;
import static com.workplace.home.SharedMemoryFixtures.user;
import static com.workplace.jooq.Tables.HOME_SESSION;
import static com.workplace.jooq.Tables.SHARED_AI_MEMORY_CHANGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.home.AiMemoryTestFixtures;
import com.workplace.home.dto.SharedAiMemoryRequestBody;
import com.workplace.home.exception.MemoryCleanupAiException;
import com.workplace.home.outbound.AiAgentSharedMemoryClient;
import com.workplace.home.outbound.MemoryCleanupMessages;
import com.workplace.home.outbound.SharedMemoryMessages.CheckRequest;
import com.workplace.home.outbound.SharedMemoryMessages.CheckResult;
import com.workplace.home.outbound.SharedMemoryMessages.ExtractRequest;
import com.workplace.home.outbound.SharedMemoryMessages.ExtractResult;
import com.workplace.home.outbound.SharedMemoryMessages.Op;
import com.workplace.home.outbound.SharedMemoryMessages.Verdict;
import com.workplace.home.repository.HomeMessageRepository;
import com.workplace.home.repository.SharedAiMemoryForgottenRepository;
import com.workplace.home.repository.SharedAiMemoryRepository;
import com.workplace.home.repository.SharedAiMemoryRepository.Row;
import com.workplace.home.service.SessionCleanupInput.Utterance;
import com.workplace.home.service.SharedSpace.SpaceKey;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.FakeTextEmbedderConfig;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.service.WikiSpaceService;
import java.net.http.HttpTimeoutException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;

/**
 * WP-386 스펙 6.3 — 공간별 묶음·발화자 권한 재확인(준비·적용 두 번)·AI 답 제외(입력이 사용자 발화뿐)·검사 통과분만·사람 항목과 조직 보호·지운
 * 기록·한도·같은 말·사람 편집 겹침·실패 규칙(에이전트 불가만 세션을 미룸)·발화자 추적 금지. ai-agent 는 목, 임베딩은 가짜. 트랜잭션 롤백이라 커밋된 데이터가
 * 남지 않는다.
 */
@Transactional
@Import(FakeTextEmbedderConfig.class)
class SharedMemoryExtractionTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired SharedMemoryExtractionParticipant participant;
  @Autowired HomeSessionService sessions;
  // 공간 묶기(spacesOf)·공간 읽기(repo.all)에 DB 오류를 심는 데 쓴다(기본은 실제 동작 그대로).
  @MockitoSpyBean HomeMessageRepository messages;
  @MockitoSpyBean SharedAiMemoryRepository repo;
  @Autowired SharedAiMemoryForgottenRepository forgottenRepo;
  @Autowired SharedAiMemoryForgottenService forgotten;
  @Autowired SharedAiMemoryService service;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository projectMembers;
  @Autowired WikiSpaceService wikiService;
  @Autowired AiMemoryCleanupApplier cleanupApplier;
  @Autowired SharedAiMemoryRequestService requests;
  @Autowired SharedAiMemoryChangeService changeService;
  @MockitoBean AssistantResolver assistantResolver;
  @MockitoBean AiAgentSharedMemoryClient client;
  // 한 공간의 적용에 SQL 오류를 심는 데 쓴다(기본은 실제 동작 그대로).
  @MockitoSpyBean SharedAiMemoryChangeLog changeLog;

  long owner;
  long speaker;
  long projectId;
  SpaceKey pk;
  UUID sessionId;
  final OffsetDateTime t0 = OffsetDateTime.of(2026, 10, 15, 0, 0, 0, 0, ZoneOffset.UTC);

  @BeforeEach
  void seed() {
    owner = user(dsl);
    speaker = user(dsl);
    var p = project(projectService, owner, "EXT", "TEAM");
    projectId = p.id();
    addProjectMember(projectMembers, projectId, speaker);
    pk = SpaceKey.of("PROJECT", projectId);
    sessionId = sessions.create(speaker).id();
    // 기본: 검사는 후보 수만큼 모두 통과.
    when(client.check(any()))
        .thenAnswer(
            inv -> {
              int n = ((CheckRequest) inv.getArgument(0)).candidates().size();
              List<Verdict> v = new ArrayList<>();
              for (int i = 0; i < n; i++) v.add(new Verdict(true, false, "팀 규칙"));
              return new CheckResult(v);
            });
  }

  /** 사용자 발화 하나(공간이 있으면 남긴다) → Utterance. */
  private Utterance say(String text, SpaceKey space) {
    long id = sessions.appendMessage(speaker, sessionId, "USER", text, null, null, null);
    if (space != null) messages.setSpace(sessionId, id, space);
    return new Utterance(id, text);
  }

  private SessionCleanupInput input(Utterance... us) {
    return new SessionCleanupInput(
        1L,
        speaker,
        sessionId,
        null,
        us[us.length - 1].messageId(),
        List.of(us),
        List.of(),
        List.of(),
        new AssistantSpec(9L, "claude-sonnet-4-6", "NORMAL", 8, 60000, "claude-haiku-5-5"),
        LocalDate.of(2026, 10, 15),
        Instant.now(),
        Set.of());
  }

  private static Op add(String content) {
    return new Op("ADD", List.of(), content, 0, "팀이 정한 규칙");
  }

  private void extractReturns(Op... ops) {
    when(client.extract(any())).thenReturn(new ExtractResult(List.of(ops)));
  }

  private void run(SessionCleanupInput in) {
    participant.prepare(in).applyInTransaction();
  }

  private static MemoryCleanupAiException agentDown() {
    return new MemoryCleanupAiException("x", new ResourceAccessException("Connection refused"));
  }

  private static MemoryCleanupAiException badGateway() {
    return new MemoryCleanupAiException("x", new HttpServerErrorException(HttpStatus.BAD_GATEWAY));
  }

  @Test
  void 공간마다_그_공간_발화만_보낸다() {
    long wiki = teamWiki(wikiService, owner, "개발팀 노트");
    addWikiMember(wikiService, owner, wiki, speaker, "EDITOR");
    SpaceKey wk = SpaceKey.of("WIKI_SPACE", wiki);
    extractReturns();
    run(
        input(
            say("우리 프로젝트는 배포를 API 먼저 하기로 했어", pk),
            say("오늘 점심 뭐 먹지", null),
            say("이 스페이스 용어집은 가나다순으로 정리하자", wk),
            say("PR 은 두 명 승인 뒤 머지하는 걸로 하자", pk)));

    ArgumentCaptor<ExtractRequest> cap = ArgumentCaptor.forClass(ExtractRequest.class);
    verify(client, times(2)).extract(cap.capture());
    var all = cap.getAllValues();
    var project =
        all.stream().filter(r -> r.spaceType().equals("PROJECT")).findFirst().orElseThrow();
    var space =
        all.stream().filter(r -> r.spaceType().equals("WIKI_SPACE")).findFirst().orElseThrow();
    assertThat(project.utterances())
        .containsExactly("우리 프로젝트는 배포를 API 먼저 하기로 했어", "PR 은 두 명 승인 뒤 머지하는 걸로 하자");
    assertThat(project.spaceName()).isEqualTo("EXT 프로젝트(EXT)");
    assertThat(project.model()).isEqualTo("claude-haiku-5-5");
    assertThat(space.utterances()).containsExactly("이 스페이스 용어집은 가나다순으로 정리하자");
  }

  @Test
  void 검사를_통과한_ADD_는_발화자를_남기지_않고_저장된다() {
    extractReturns(add("배포는 API 먼저 한다"));
    run(input(say("우리 프로젝트는 배포를 API 먼저 하기로 했어", pk)));

    List<Row> rows = repo.all(pk);
    assertThat(rows).hasSize(1);
    Row r = rows.get(0);
    assertThat(r.origin()).isEqualTo("AI_EXTRACTED");
    assertThat(r.authorUserId()).isNull();
    assertThat(r.updatedBy()).isNull();
    var ch =
        dsl.selectFrom(SHARED_AI_MEMORY_CHANGE)
            .where(SHARED_AI_MEMORY_CHANGE.MEMORY_ID.eq(r.id()))
            .fetchOne();
    assertThat(ch.getActorUserId()).isNull();
    assertThat(ch.getActorKind()).isEqualTo("AI");
    assertThat(ch.getRunId()).isNotNull().isNotEqualTo(sessionId);
    // 발화자 id·세션 id 가 기록 JSON 어디에도 없다.
    String json = ch.getBefore().data() + (ch.getAfter() == null ? "" : ch.getAfter().data());
    assertThat(json)
        .doesNotContain(sessionId.toString())
        .doesNotContain("authorUserId")
        .doesNotContain(String.valueOf(speaker));
  }

  @Test
  void 공간마다_새_묶음_id_로_기록한다() {
    long wiki = teamWiki(wikiService, owner, "개발팀 노트");
    addWikiMember(wikiService, owner, wiki, speaker, "EDITOR");
    SpaceKey wk = SpaceKey.of("WIKI_SPACE", wiki);
    extractReturns(add("배포는 API 먼저 한다"));
    run(input(say("배포는 API 먼저 하자", pk), say("배포는 API 먼저 하자", wk)));

    Set<UUID> runs =
        dsl
            .selectFrom(SHARED_AI_MEMORY_CHANGE)
            .where(
                SHARED_AI_MEMORY_CHANGE.MEMORY_ID.in(
                    repo.all(pk).get(0).id(), repo.all(wk).get(0).id()))
            .fetch(SHARED_AI_MEMORY_CHANGE.RUN_ID)
            .stream()
            .collect(Collectors.toSet());
    assertThat(runs).hasSize(2).doesNotContain(sessionId);
  }

  @Test
  void 검사를_통과하지_못하면_저장하지_않는다() {
    // 기본 Answer 가 있는 목을 when(...) 으로 다시 스텁하면 그 Answer 가 null 인자로 불려 NPE 가 난다 — doReturn 으로.
    doReturn(new CheckResult(List.of(new Verdict(true, true, "개인 일정이 섞임"))))
        .when(client)
        .check(any());
    extractReturns(add("배포는 API 먼저 하고 김철수는 이번 주 휴가다"));
    run(input(say("배포는 API 먼저, 근데 난 이번 주 휴가야", pk)));
    assertThat(repo.count(pk)).isZero();
  }

  @Test
  void 검사_결과_개수가_후보와_다르면_모두_불통과다() {
    doReturn(new CheckResult(List.of())).when(client).check(any());
    extractReturns(add("배포는 API 먼저 한다"));
    run(input(say("우리 프로젝트는 배포를 API 먼저 하기로 했어", pk)));
    assertThat(repo.count(pk)).isZero();
  }

  @Test
  void 검사는_열_개씩_나눠_부른다() {
    Op[] ops =
        IntStream.range(0, 11).mapToObj(i -> add("팀 규칙 번호 " + i + " 를 지킨다")).toArray(Op[]::new);
    extractReturns(ops);
    run(input(say("우리 팀 규칙을 열한 개 정했어", pk)));
    ArgumentCaptor<CheckRequest> cap = ArgumentCaptor.forClass(CheckRequest.class);
    verify(client, times(2)).check(cap.capture());
    assertThat(cap.getAllValues()).extracting(r -> r.candidates().size()).containsExactly(10, 1);
    assertThat(repo.count(pk)).isEqualTo(11);
  }

  @Test
  void 검사_호출이_실패하면_모두_불통과로_저장하지_않고_던지지_않는다() {
    doThrow(badGateway()).when(client).check(any());
    extractReturns(add("배포는 API 먼저 한다"));
    run(input(say("우리 프로젝트는 배포를 API 먼저 하기로 했어", pk)));
    assertThat(repo.count(pk)).isZero();
  }

  @Test
  void 추출이_502_면_그_공간만_건너뛰고_던지지_않는다() {
    long wiki = teamWiki(wikiService, owner, "개발팀 노트");
    addWikiMember(wikiService, owner, wiki, speaker, "EDITOR");
    SpaceKey wk = SpaceKey.of("WIKI_SPACE", wiki);
    when(client.extract(any()))
        .thenAnswer(
            inv -> {
              if ("PROJECT".equals(((ExtractRequest) inv.getArgument(0)).spaceType())) {
                throw badGateway();
              }
              return new ExtractResult(List.of(add("용어집은 가나다순으로 정리한다")));
            });
    run(input(say("우리 프로젝트는 배포를 API 먼저 하기로 했어", pk), say("용어집은 가나다순으로 정리하자", wk)));
    assertThat(repo.count(pk)).isZero();
    assertThat(repo.count(wk)).isEqualTo(1);
  }

  @Test
  void 읽기_시간_초과도_그_공간만_건너뛰고_던지지_않는다() {
    when(client.extract(any()))
        .thenThrow(
            new MemoryCleanupAiException(
                "x", new ResourceAccessException("t", new HttpTimeoutException("response"))));
    run(input(say("우리 프로젝트는 배포를 API 먼저 하기로 했어", pk)));
    assertThat(repo.count(pk)).isZero();
  }

  @Test
  void ai_agent_가_응답하지_않으면_세션을_미루도록_던진다() {
    when(client.extract(any())).thenThrow(agentDown());
    SessionCleanupInput in = input(say("우리 프로젝트는 배포를 API 먼저 하기로 했어", pk));
    assertThatThrownBy(() -> participant.prepare(in)).isInstanceOf(MemoryCleanupAiException.class);
  }

  @Test
  void 검사_때_ai_agent_가_응답하지_않아도_세션을_미루도록_던진다() {
    extractReturns(add("배포는 API 먼저 한다"));
    doThrow(agentDown()).when(client).check(any());
    SessionCleanupInput in = input(say("우리 프로젝트는 배포를 API 먼저 하기로 했어", pk));
    assertThatThrownBy(() -> participant.prepare(in)).isInstanceOf(MemoryCleanupAiException.class);
  }

  @Test
  void 형식이_깨진_op_는_버리고_던지지_않는다() {
    extractReturns(
        new Op("DROP", List.of(), "배포는 API 먼저 한다", 0, "r"),
        new Op(null, List.of(), "배포는 API 먼저 한다", 0, "r"),
        new Op("ADD", List.of(), "   ", 0, "r"),
        new Op("ADD", List.of(), "가".repeat(301), 0, "r"),
        new Op("ADD", List.of(), "배포는 API 먼저 한다", null, "r"),
        new Op("ADD", List.of(), "배포는 API 먼저 한다", -1, "r"),
        new Op("ADD", List.of(7L), "배포는 API 먼저 한다", 0, "r"),
        new Op("UPDATE", null, "배포는 API 먼저 한다", 0, "r"),
        add("정상 규칙은 하나만 남는다"));
    run(input(say("우리 프로젝트는 배포를 API 먼저 하기로 했어", pk)));
    assertThat(repo.all(pk)).extracting(Row::content).containsExactly("정상 규칙은 하나만 남는다");
  }

  @Test
  void 내용_op_는_공간당_20개까지만_받고_검사는_두_번이다() {
    Op[] ops =
        IntStream.range(0, 25).mapToObj(i -> add("팀 규칙 번호 " + i + " 를 지킨다")).toArray(Op[]::new);
    extractReturns(ops);
    run(input(say("우리 팀 규칙을 스물다섯 개 정했어", pk)));
    ArgumentCaptor<CheckRequest> cap = ArgumentCaptor.forClass(CheckRequest.class);
    verify(client, times(2)).check(cap.capture());
    assertThat(cap.getAllValues()).extracting(r -> r.candidates().size()).containsExactly(10, 10);
    assertThat(repo.all(pk)).hasSize(SharedMemoryExtractionParticipant.MAX_CONTENT_OPS);
  }

  @Test
  void 상한을_넘어도_FORGET_은_세지_않는다() {
    Row old = repo.insert(pk, "낡은 규칙", "AI_EXTRACTED", null, null, t0);
    List<Op> ops = new ArrayList<>();
    IntStream.range(0, 20).forEach(i -> ops.add(add("팀 규칙 번호 " + i + " 를 지킨다")));
    ops.add(new Op("FORGET", List.of(old.id()), null, 0, "r"));
    extractReturns(ops.toArray(Op[]::new));
    run(input(say("우리 팀 규칙을 새로 정했어", pk)));
    assertThat(repo.findById(old.id())).isEmpty();
  }

  /**
   * 공간 하나의 적용이 SQL 오류로 실패해도 그 공간만 세이브포인트로 되돌리고, 같은 WP-385 적용 트랜잭션의 개인 정리 ADD·다른 공간 적용·경계 갱신은 남는다.
   * 실패 공간(PROJECT, param 순서상 먼저)은 오류 전에 넣은 행까지 되돌아간다.
   */
  @Test
  void 한_공간의_적용이_실패해도_개인_정리와_다른_공간과_경계는_남는다() {
    long wiki = teamWiki(wikiService, owner, "개발팀 노트");
    addWikiMember(wikiService, owner, wiki, speaker, "EDITOR");
    SpaceKey wk = SpaceKey.of("WIKI_SPACE", wiki);
    extractReturns(add("배포는 API 먼저 한다"));
    SessionCleanupInput in = input(say("배포는 API 먼저 하자", pk), say("배포는 API 먼저 하자", wk));
    var prepared = participant.prepare(in);

    doAnswer(
            inv -> {
              if (pk.equals(inv.getArgument(0)))
                dsl.execute("select 1/0"); // 실제 SQL 오류 → 세이브포인트 없이는 트랜잭션이 망가진다
              return inv.callRealMethod();
            })
        .when(changeLog)
        .record(any(), any(), any(), any(), anyLong(), any(), any(), any());

    boolean applied =
        cleanupApplier.apply(
            in,
            List.of(
                new MemoryCleanupMessages.Op(
                    "ADD", null, "배포 일을 맡고 있다", "CONTEXT", null, null, 0, "새로 알게 됨")),
            java.util.Map.of(),
            List.of(prepared));

    assertThat(applied).isTrue();
    assertThat(AiMemoryTestFixtures.allMemories(dsl, speaker))
        .extracting(r -> r.content())
        .containsExactly("배포 일을 맡고 있다");
    assertThat(repo.count(pk)).isZero();
    assertThat(repo.all(wk)).extracting(Row::content).containsExactly("배포는 API 먼저 한다");
    assertThat(
            dsl.select(HOME_SESSION.MEMORY_PROCESSED_MESSAGE_ID)
                .from(HOME_SESSION)
                .where(HOME_SESSION.ID.eq(sessionId))
                .fetchOne(HOME_SESSION.MEMORY_PROCESSED_MESSAGE_ID))
        .isEqualTo(in.uptoId());
  }

  /**
   * 직접 요청(USER_REQUESTED)을 사람이 되돌리면 지운 기록에 남아, 같은 발화를 읽는 배경 추출이 같은 말을 AI_EXTRACTED 로 되살리지
   * 않는다(WP-385 개인 쪽 deleteIfExists → forgotten.remember 와 같은 규칙).
   */
  @Test
  void 직접_요청을_되돌리면_배경_추출이_같은_말을_다시_넣지_않는다() {
    when(assistantResolver.resolveOrEmpty(anyLong()))
        .thenReturn(
            Optional.of(
                new AssistantSpec(
                    9L, "claude-sonnet-4-6", "NORMAL", 8, 60000, "claude-haiku-5-5")));
    when(client.checkNow(any()))
        .thenReturn(new CheckResult(List.of(new Verdict(true, false, "팀 규칙"))));
    var saved =
        requests.request(speaker, new SharedAiMemoryRequestBody("배포는 API 먼저 한다", "EXT", null));
    assertThat(repo.findById(saved.memoryId()).orElseThrow().origin()).isEqualTo("USER_REQUESTED");

    changeService.undo(speaker, saved.changeId());
    assertThat(repo.count(pk)).isZero();

    extractReturns(add("배포는 API 먼저 한다"));
    run(input(say("팀 규칙으로 기억해: 배포는 API 먼저 한다", pk)));
    assertThat(repo.count(pk)).isZero();
    assertThat(forgottenRepo.contents(pk)).containsExactly("배포는 API 먼저 한다");
  }

  /** 요청으로 저장된 항목을 지워도(작성자 본인) 같은 발화에서 배경 추출이 되살리지 않는다. 직접 추가(USER_ADDED)는 남기지 않는다. */
  @Test
  void 요청_항목을_지워도_배경_추출이_다시_넣지_않는다() {
    var added = service.insertLocked(speaker, pk, "배포는 API 먼저 한다", "USER_REQUESTED");
    service.delete(speaker, added.row().id());
    assertThat(repo.count(pk)).isZero();

    extractReturns(add("배포는 API 먼저 한다"));
    run(input(say("팀 규칙으로 기억해: 배포는 API 먼저 한다", pk)));
    assertThat(repo.count(pk)).isZero();
  }

  /**
   * CR1 — AI 의 고침을 사람이 되돌리면 거절한 문장이 지운 기록에 남아, 같은 발화를 다시 읽는 배경 추출이 같은 고침을 되풀이하지 않는다. 되돌린 행은 사람이
   * 건드렸다는 이유로도 지켜지므로(updated_by), 지운 기록 자체는 같은 말을 새 ADD 로 넣으려는 시도로 확인한다.
   */
  @Test
  void AI_고침을_되돌리면_배경_추출이_같은_고침이나_추가를_되풀이하지_않는다() {
    Row ai = repo.insert(pk, "스프린트는 2주", "AI_EXTRACTED", null, null, t0);
    extractReturns(new Op("UPDATE", List.of(ai.id()), "스프린트는 3주 단위다", 0, "r"));
    run(input(say("스프린트를 3주로 바꾸자", pk)));
    assertThat(repo.findById(ai.id()).orElseThrow().content()).isEqualTo("스프린트는 3주 단위다");
    long changeId =
        dsl.select(SHARED_AI_MEMORY_CHANGE.ID)
            .from(SHARED_AI_MEMORY_CHANGE)
            .where(
                SHARED_AI_MEMORY_CHANGE
                    .MEMORY_ID
                    .eq(ai.id())
                    .and(SHARED_AI_MEMORY_CHANGE.ACTION.eq("UPDATED")))
            .fetchOne(SHARED_AI_MEMORY_CHANGE.ID);

    changeService.undo(owner, changeId);
    assertThat(repo.findById(ai.id()).orElseThrow().content()).isEqualTo("스프린트는 2주");
    assertThat(forgottenRepo.contents(pk)).containsExactly("스프린트는 3주 단위다");

    // 같은 UPDATE 와, 같은 말을 새로 넣는 ADD 를 다시 내도 적용되지 않는다.
    extractReturns(new Op("UPDATE", List.of(ai.id()), "스프린트는 3주 단위다", 0, "r"), add("스프린트는 3주 단위다"));
    run(input(say("스프린트를 3주로 바꾸자", pk)));
    assertThat(repo.all(pk)).extracting(Row::content).containsExactly("스프린트는 2주");
  }

  /**
   * CR2 — 사람이 고친 AI 항목(출처는 AI 그대로, updated_by 만 사람)은 AI 의 UPDATE·MERGE·FORGET 대상이 아니고, ai-agent 에는
   * 사람 항목으로 알려 "바꾸지 말 것" 표시가 붙는다. 고치지 않은 AI 항목은 그대로 AI 출처다.
   */
  @Test
  void 사람이_고친_AI_항목은_추출의_고치기_합치기_지우기_대상이_아니다() {
    Row edited = repo.insert(pk, "스프린트는 2주", "AI_EXTRACTED", null, null, t0);
    Row plain = repo.insert(pk, "코드 리뷰는 두 명 승인", "AI_EXTRACTED", null, null, t0);
    service.update(owner, edited.id(), "스프린트는 2주 단위이고 월요일에 시작한다");
    Row human = repo.findById(edited.id()).orElseThrow();
    assertThat(human.origin()).isEqualTo("AI_EXTRACTED");
    assertThat(human.updatedBy()).isEqualTo(owner);

    extractReturns(
        new Op("UPDATE", List.of(edited.id()), "스프린트는 3주 단위다", 0, "r"),
        new Op("MERGE", List.of(edited.id(), plain.id()), "스프린트와 리뷰 규칙을 합친다", 0, "r"),
        new Op("FORGET", List.of(edited.id()), null, 0, "r"));
    run(input(say("스프린트를 3주로 바꾸고 리뷰 규칙과 합치자", pk)));

    Row after = repo.findById(edited.id()).orElseThrow();
    assertThat(after.content()).isEqualTo("스프린트는 2주 단위이고 월요일에 시작한다");
    assertThat(after.updatedBy()).isEqualTo(owner);
    assertThat(repo.findById(plain.id()).orElseThrow().content()).isEqualTo("코드 리뷰는 두 명 승인");

    ArgumentCaptor<ExtractRequest> cap = ArgumentCaptor.forClass(ExtractRequest.class);
    verify(client).extract(cap.capture());
    var refs = cap.getValue().memories();
    assertThat(refs.stream().filter(r -> r.id() == edited.id()).findFirst().orElseThrow().origin())
        .isEqualTo("USER_ADDED");
    assertThat(refs.stream().filter(r -> r.id() == plain.id()).findFirst().orElseThrow().origin())
        .isEqualTo("AI_EXTRACTED");
  }

  /** 공간 묶기(DB 읽기)가 깨져도 던지지 않고 할 일 없음으로 돌아온다 — 개인 정리 결과까지 버려지지 않게. */
  @Test
  void 공간_묶기가_실패해도_던지지_않고_할_일_없음이다() {
    doThrow(new DataAccessResourceFailureException("db down")).when(messages).spacesOf(any());
    var prepared = participant.prepare(input(say("우리 프로젝트는 배포를 API 먼저 하기로 했어", pk)));
    assertThat(prepared).isSameAs(SessionCleanupParticipant.Prepared.NONE);
    verify(client, never()).extract(any());
  }

  /** 한 공간의 읽기(DB)가 실패해도 던지지 않고 다음 공간을 이어서 준비한다. */
  @Test
  void 한_공간의_읽기가_실패해도_던지지_않고_다른_공간을_준비한다() {
    long wiki = teamWiki(wikiService, owner, "개발팀 노트");
    addWikiMember(wikiService, owner, wiki, speaker, "EDITOR");
    SpaceKey wk = SpaceKey.of("WIKI_SPACE", wiki);
    extractReturns(add("용어집은 가나다순으로 정리한다"));
    SessionCleanupInput in = input(say("배포는 API 먼저 하자", pk), say("용어집은 가나다순으로 정리하자", wk));
    doThrow(new DataAccessResourceFailureException("db down")).when(repo).all(pk);

    var prepared = participant.prepare(in);

    ArgumentCaptor<ExtractRequest> cap = ArgumentCaptor.forClass(ExtractRequest.class);
    verify(client, times(1)).extract(cap.capture());
    assertThat(cap.getValue().spaceType()).isEqualTo("WIKI_SPACE");
    assertThat(prepared).isNotSameAs(SessionCleanupParticipant.Prepared.NONE);
  }

  /** 한 공간의 준비가 예상 밖 오류로 실패해도 그 공간만 건너뛰고, 다른 공간과 WP-385 개인 정리 ADD 는 그대로 적용된다. */
  @Test
  void 한_공간의_준비가_예상_밖_오류로_실패해도_다른_공간과_개인_정리는_적용된다() {
    long wiki = teamWiki(wikiService, owner, "개발팀 노트");
    addWikiMember(wikiService, owner, wiki, speaker, "EDITOR");
    SpaceKey wk = SpaceKey.of("WIKI_SPACE", wiki);
    when(client.extract(any()))
        .thenAnswer(
            inv -> {
              if ("PROJECT".equals(((ExtractRequest) inv.getArgument(0)).spaceType())) {
                throw new IllegalStateException("예상 밖 오류");
              }
              return new ExtractResult(List.of(add("용어집은 가나다순으로 정리한다")));
            });
    SessionCleanupInput in = input(say("배포는 API 먼저 하자", pk), say("용어집은 가나다순으로 정리하자", wk));
    var prepared = participant.prepare(in);

    boolean applied =
        cleanupApplier.apply(
            in,
            List.of(
                new MemoryCleanupMessages.Op(
                    "ADD", null, "배포 일을 맡고 있다", "CONTEXT", null, null, 0, "새로 알게 됨")),
            java.util.Map.of(),
            List.of(prepared));

    assertThat(applied).isTrue();
    assertThat(AiMemoryTestFixtures.allMemories(dsl, speaker))
        .extracting(r -> r.content())
        .containsExactly("배포 일을 맡고 있다");
    assertThat(repo.count(pk)).isZero();
    assertThat(repo.all(wk)).extracting(Row::content).containsExactly("용어집은 가나다순으로 정리한다");
  }

  @Test
  void 사람_항목과_조직_지침은_고치거나_지우지_않는다() {
    Row human = repo.insert(pk, "회의록은 노트에 남긴다", "USER_ADDED", owner, owner, t0);
    Row requested = repo.insert(pk, "PR 에는 캡처를 붙인다", "USER_REQUESTED", owner, owner, t0);
    Row org = repo.insert(SpaceKey.of("ORG", null), "모든 문서는 존댓말", "USER_ADDED", owner, owner, t0);
    extractReturns(
        new Op("UPDATE", List.of(human.id()), "회의록은 위키에 남긴다", 0, "r"),
        new Op("FORGET", List.of(requested.id()), null, 0, "r"),
        new Op("FORGET", List.of(org.id()), null, 0, "r"));
    run(input(say("회의록은 이제 위키에 남기고 캡처는 안 붙여도 돼", pk)));
    assertThat(repo.findById(human.id()).orElseThrow().content()).isEqualTo("회의록은 노트에 남긴다");
    assertThat(repo.findById(requested.id())).isPresent();
    assertThat(repo.findById(org.id())).isPresent();
  }

  @Test
  void AI_항목은_고치고_합치고_지운다() {
    Row a = repo.insert(pk, "보고서는 표로", "AI_EXTRACTED", null, null, t0);
    Row b = repo.insert(pk, "요약은 표로", "AI_EXTRACTED", null, null, t0);
    Row c = repo.insert(pk, "배포는 금요일에 한다", "AI_CLEANED", null, null, t0);
    extractReturns(
        new Op("MERGE", List.of(a.id(), b.id()), "보고서와 요약은 표로 정리한다", 0, "겹침"),
        new Op("FORGET", List.of(c.id()), null, 0, "금요일 배포 금지로 바뀜"));
    run(input(say("보고서랑 요약은 표로 하고, 이제 금요일엔 배포 안 해", pk)));
    Row merged = repo.findById(a.id()).orElseThrow();
    assertThat(merged.content()).isEqualTo("보고서와 요약은 표로 정리한다");
    assertThat(merged.origin()).isEqualTo("AI_CLEANED");
    assertThat(merged.updatedBy()).isNull();
    assertThat(repo.findById(b.id())).isEmpty();
    assertThat(repo.findById(c.id())).isEmpty();
    // AI 의 FORGET 은 지운 기록에 넣지 않는다(사람이 지운 것만).
    assertThat(forgottenRepo.contents(pk)).isEmpty();
    assertThat(
            dsl.fetchCount(
                SHARED_AI_MEMORY_CHANGE,
                SHARED_AI_MEMORY_CHANGE
                    .SPACE_ID
                    .eq(projectId)
                    .and(SHARED_AI_MEMORY_CHANGE.ACTION.eq("MERGED"))))
        .isEqualTo(1);
    assertThat(
            dsl.fetchCount(
                SHARED_AI_MEMORY_CHANGE,
                SHARED_AI_MEMORY_CHANGE
                    .SPACE_ID
                    .eq(projectId)
                    .and(SHARED_AI_MEMORY_CHANGE.ACTION.eq("DELETED"))))
        .isEqualTo(1);
  }

  @Test
  void 같은_대상을_두_번_쓰는_op_는_뒤의_것을_버린다() {
    Row a = repo.insert(pk, "보고서는 표로", "AI_EXTRACTED", null, null, t0);
    extractReturns(
        new Op("UPDATE", List.of(a.id()), "보고서는 표로 정리한다", 0, "r"),
        new Op("FORGET", List.of(a.id()), null, 0, "r"));
    run(input(say("보고서는 표로 정리하자", pk)));
    assertThat(repo.findById(a.id()).orElseThrow().content()).isEqualTo("보고서는 표로 정리한다");
  }

  @Test
  void 고친_결과가_다른_항목과_같은_말이면_버린다() {
    Row human = repo.insert(pk, "회의록은 노트에 남긴다", "USER_ADDED", owner, owner, t0);
    Row ai = repo.insert(pk, "회의록은 위키에", "AI_EXTRACTED", null, null, t0);
    extractReturns(new Op("UPDATE", List.of(ai.id()), "회의록은 노트에 남긴다.", 0, "r"));
    run(input(say("회의록은 노트에 남기자", pk)));
    assertThat(repo.findById(ai.id()).orElseThrow().content()).isEqualTo("회의록은 위키에");
    assertThat(repo.findById(human.id())).isPresent();
  }

  @Test
  void 지운_기록과_겹치면_버린다() {
    forgotten.remember(pk, List.of("배포는 API 먼저 한다"));
    extractReturns(add("배포는 API 먼저 한다."));
    run(input(say("우리 프로젝트는 배포를 API 먼저 하기로 했어", pk)));
    assertThat(repo.count(pk)).isZero();
  }

  @Test
  void 가득_찬_공간에는_ADD_를_버린다() {
    for (int i = 0; i < 50; i++) {
      repo.insert(pk, "사람 규칙 " + i, "USER_ADDED", owner, owner, t0);
    }
    extractReturns(add("배포는 API 먼저 한다"));
    run(input(say("우리 프로젝트는 배포를 API 먼저 하기로 했어", pk)));
    assertThat(repo.count(pk)).isEqualTo(50);
    assertThat(repo.all(pk)).extracting(Row::origin).containsOnly("USER_ADDED");
  }

  @Test
  void 같은_말은_다시_넣지_않는다() {
    repo.insert(pk, "배포는 API 먼저 한다", "USER_ADDED", owner, owner, t0);
    extractReturns(add("배포는 API 먼저 한다!"), add("코드 리뷰는 두 명 승인 뒤 머지한다"), add("코드 리뷰는 두 명 승인 뒤 머지한다"));
    run(input(say("배포는 API 먼저고 코드 리뷰는 두 명 승인 뒤 머지하자", pk)));
    assertThat(repo.all(pk))
        .extracting(Row::content)
        .containsExactlyInAnyOrder("배포는 API 먼저 한다", "코드 리뷰는 두 명 승인 뒤 머지한다");
  }

  @Test
  void 수집_뒤에_사람이_고친_항목은_건드리지_않는다() {
    Row ai = repo.insert(pk, "스프린트는 2주", "AI_EXTRACTED", null, null, t0);
    extractReturns(new Op("UPDATE", List.of(ai.id()), "스프린트는 3주 단위다", 0, "r"));
    var prepared = participant.prepare(input(say("스프린트를 3주로 바꾸자", pk)));
    service.update(owner, ai.id(), "스프린트는 2주 단위이고 월요일에 시작한다");
    prepared.applyInTransaction();
    assertThat(repo.findById(ai.id()).orElseThrow().content()).isEqualTo("스프린트는 2주 단위이고 월요일에 시작한다");
  }

  @Test
  void 발화자가_추가_권한을_잃었으면_그_공간은_건너뛴다() {
    projectMembers.delete(projectId, speaker);
    extractReturns(add("배포는 API 먼저 한다"));
    run(input(say("우리 프로젝트는 배포를 API 먼저 하기로 했어", pk)));
    verify(client, never()).extract(any());
    assertThat(repo.count(pk)).isZero();
  }

  @Test
  void 준비_뒤_적용_전에_권한을_잃어도_적용하지_않는다() {
    extractReturns(add("배포는 API 먼저 한다"));
    var prepared = participant.prepare(input(say("우리 프로젝트는 배포를 API 먼저 하기로 했어", pk)));
    projectMembers.delete(projectId, speaker);
    prepared.applyInTransaction();
    assertThat(repo.count(pk)).isZero();
  }

  @Test
  void 근거_번호가_범위_밖이면_버린다() {
    extractReturns(new Op("ADD", List.of(), "배포는 API 먼저 한다", 3, "r"));
    run(input(say("우리 프로젝트는 배포를 API 먼저 하기로 했어", pk)));
    assertThat(repo.count(pk)).isZero();
  }

  @Test
  void 공간_없는_대화는_아무것도_부르지_않는다() {
    run(input(say("오늘 할 일 정리해줘", null)));
    verify(client, never()).extract(any());
    verify(client, never()).check(any());
  }

  @Test
  void 조직_지침_화면의_발화는_추출하지_않는다() {
    run(input(say("모든 문서는 존댓말로 쓰자", SpaceKey.of("ORG", null))));
    verify(client, never()).extract(any());
  }

  /**
   * 발화자 추적 금지의 구조 보증(P4) — 공용 메모리·기록·지운 기록 세 표의 열이 정확히 이 집합이다. 세션·메시지·발화자 열이 생기면 이 테스트가 깨져 설계 결정을
   * 다시 보게 한다. author_user_id·updated_by·actor_user_id 는 사람이 직접 추가·요청·편집한 경우만 채우고, 대화에서 뽑힌 항목은 늘
   * NULL 이다.
   */
  @Test
  void 공용_메모리_세_표의_열은_정해진_집합뿐이다() {
    assertThat(columnsOf("shared_ai_memory"))
        .containsExactlyInAnyOrder(
            "id",
            "tenant_id",
            "space_type",
            "space_id",
            "content",
            "origin",
            "author_user_id",
            "created_at",
            "updated_at",
            "updated_by",
            "search_tv",
            "embedding");
    assertThat(columnsOf("shared_ai_memory_change"))
        .containsExactlyInAnyOrder(
            "id",
            "tenant_id",
            "space_type",
            "space_id",
            "run_id",
            "action",
            "actor_user_id",
            "actor_kind",
            "memory_id",
            "before",
            "after",
            "created_at",
            "undone_at",
            "undone_by");
    assertThat(columnsOf("shared_ai_memory_forgotten"))
        .containsExactlyInAnyOrder(
            "id",
            "tenant_id",
            "space_type",
            "space_id",
            "content",
            "normalized",
            "embedding",
            "created_at");
  }

  private List<String> columnsOf(String table) {
    return dsl.fetch(
            "select column_name from information_schema.columns"
                + " where table_schema = current_schema() and table_name = ?",
            table)
        .getValues(0, String.class);
  }
}
