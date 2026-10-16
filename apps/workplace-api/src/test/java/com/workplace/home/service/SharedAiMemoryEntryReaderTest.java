package com.workplace.home.service;

import static com.workplace.home.SharedMemoryFixtures.addProjectMember;
import static com.workplace.home.SharedMemoryFixtures.project;
import static com.workplace.home.SharedMemoryFixtures.teamWiki;
import static com.workplace.home.SharedMemoryFixtures.user;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.ai.SharedMemories;
import com.workplace.global.ai.SharedMemoryLine;
import com.workplace.home.repository.SharedAiMemoryRepository;
import com.workplace.home.service.SharedSpace.SpaceKey;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.service.WikiSpaceService;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-386 스펙 5.1 — 조직 → 공간 순·최신순, 2,000토큰 예산과 「더 있음」, 권한 없는 공간·PERSONAL·에이전트 비구성원은 조직만. 조직 범위는 테넌트
 * 전체가 공유하므로 이 테스트가 넣은 줄만 골라 단언한다(다른 테스트가 커밋한 조직 줄과 섞여도 흔들리지 않게).
 */
@Transactional
class SharedAiMemoryEntryReaderTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired SharedAiMemoryEntryReader reader;
  @Autowired SharedAiMemoryRepository repo;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository projectMembers;
  @Autowired WikiSpaceService wikiService;

  final OffsetDateTime t0 = OffsetDateTime.of(2026, 10, 15, 0, 0, 0, 0, ZoneOffset.UTC);

  /** 이 테스트가 넣은 줄만 — 내용으로 거른다. */
  private static List<SharedMemoryLine> mine(SharedMemories m, Set<String> contents) {
    return m.items().stream().filter(l -> contents.contains(l.content())).toList();
  }

  @Test
  void 조직_먼저_그다음_공간_각각_최신순() {
    long owner = user(dsl);
    var p = project(projectService, owner, "RDA", "TEAM");
    var org = SpaceKey.of("ORG", null);
    var pk = SpaceKey.of("PROJECT", p.id());
    repo.insert(org, "조직 옛것", "USER_ADDED", owner, owner, t0);
    repo.insert(org, "조직 새것", "USER_ADDED", owner, owner, t0.plusMinutes(1));
    repo.insert(pk, "공간 옛것", "AI_EXTRACTED", null, null, t0);
    repo.insert(pk, "공간 새것", "USER_ADDED", owner, owner, t0.plusMinutes(1));

    SharedMemories m = reader.collectForUser(owner, pk);
    assertThat(mine(m, Set.of("조직 옛것", "조직 새것", "공간 옛것", "공간 새것")))
        .containsExactly(
            new SharedMemoryLine("조직", "조직 새것"),
            new SharedMemoryLine("조직", "조직 옛것"),
            new SharedMemoryLine("RDA 프로젝트(RDA)", "공간 새것"),
            new SharedMemoryLine("RDA 프로젝트(RDA)", "공간 옛것"));
  }

  @Test
  void 권한_없는_공간은_빼고_조직만_싣는다() {
    long owner = user(dsl);
    long outsider = user(dsl);
    var p = project(projectService, owner, "RDB", "TEAM");
    repo.insert(SpaceKey.of("ORG", null), "조직 규칙 B", "USER_ADDED", owner, owner, t0);
    repo.insert(SpaceKey.of("PROJECT", p.id()), "비밀 팀 규칙", "USER_ADDED", owner, owner, t0);
    SharedMemories m = reader.collectForUser(outsider, SpaceKey.of("PROJECT", p.id()));
    assertThat(mine(m, Set.of("조직 규칙 B", "비밀 팀 규칙")))
        .extracting(SharedMemoryLine::content)
        .containsExactly("조직 규칙 B");
  }

  /** 스펙 인수 기준 — 노트 AI 요청에 권한 없는 사용자의 공용 메모리는 실리지 않는다: 팀 스페이스 비구성원. */
  @Test
  void 팀_노트_스페이스_비구성원은_조직만_싣는다() {
    long owner = user(dsl);
    long outsider = user(dsl);
    long wiki = teamWiki(wikiService, owner, "비공개 팀 노트");
    var wk = SpaceKey.of("WIKI_SPACE", wiki);
    repo.insert(SpaceKey.of("ORG", null), "조직 규칙 W", "USER_ADDED", owner, owner, t0);
    repo.insert(wk, "스페이스 비밀 규칙", "USER_ADDED", owner, owner, t0);

    Set<String> own = Set.of("조직 규칙 W", "스페이스 비밀 규칙");
    assertThat(mine(reader.collectForUser(outsider, wk), own))
        .extracting(SharedMemoryLine::content)
        .containsExactly("조직 규칙 W");
    // 구성원인 만든 사람에게는 같은 스페이스 줄이 실린다 — 위 결과가 권한 때문이지 스페이스가 비어서가 아님을 고정한다.
    assertThat(mine(reader.collectForUser(owner, wk), own))
        .extracting(SharedMemoryLine::content)
        .containsExactly("조직 규칙 W", "스페이스 비밀 규칙");
  }

  /** PERSONAL 노트 스페이스는 공용 메모리 대상이 아니다 — 본인이어도 조직만. */
  @Test
  void 개인_노트_스페이스는_본인도_조직만_싣는다() {
    long owner = user(dsl);
    long personal = wikiService.ensurePersonalSpace(owner).id();
    var wk = SpaceKey.of("WIKI_SPACE", personal);
    repo.insert(SpaceKey.of("ORG", null), "조직 규칙 P", "USER_ADDED", owner, owner, t0);
    repo.insert(wk, "개인 스페이스 줄", "USER_ADDED", owner, owner, t0);

    assertThat(mine(reader.collectForUser(owner, wk), Set.of("조직 규칙 P", "개인 스페이스 줄")))
        .extracting(SharedMemoryLine::content)
        .containsExactly("조직 규칙 P");
  }

  @Test
  void 예산을_넘으면_뒤쪽을_세어_더_있음으로() {
    long owner = user(dsl);
    var p = project(projectService, owner, "RDC", "TEAM");
    var pk = SpaceKey.of("PROJECT", p.id());
    for (int i = 0; i < 50; i++) {
      repo.insert(
          pk, ("긴 규칙 " + i + " ").repeat(15), "USER_ADDED", owner, owner, t0.plusSeconds(i));
    }
    SharedMemories m = reader.collectForUser(owner, pk);
    // 조직 줄이 앞에 오므로 넘쳐 잘린 줄은 모두 이 프로젝트 줄이다 — 실린 프로젝트 줄 + 더 있음 = 50.
    long shown = m.items().stream().filter(l -> l.space().equals("RDC 프로젝트(RDC)")).count();
    assertThat(shown).isPositive();
    assertThat(shown + m.moreCount()).isEqualTo(50);
    assertThat(m.moreCount()).isPositive();
    assertThat(SharedAiMemoryEntryReader.estimateTokens(m))
        .isLessThanOrEqualTo(SharedAiMemoryEntryReader.BUDGET_TOKENS);
  }

  @Test
  void 에이전트는_읽을_수_있는_TEAM_OPEN_프로젝트만() {
    long owner = user(dsl);
    long agent = user(dsl);
    var team = project(projectService, owner, "RDD", "TEAM");
    var personal = project(projectService, owner, "RDE", "PERSONAL");
    repo.insert(SpaceKey.of("ORG", null), "조직 규칙 D", "USER_ADDED", owner, owner, t0);
    repo.insert(SpaceKey.of("PROJECT", team.id()), "팀 규칙", "USER_ADDED", owner, owner, t0);
    repo.insert(
        SpaceKey.of("PROJECT", personal.id()), "개인 프로젝트 규칙", "USER_ADDED", owner, owner, t0);
    Set<String> own = Set.of("조직 규칙 D", "팀 규칙", "개인 프로젝트 규칙");

    assertThat(mine(reader.collectForProjectAgent("RDD", agent), own))
        .extracting(SharedMemoryLine::content)
        .containsExactly("조직 규칙 D");
    addProjectMember(projectMembers, team.id(), agent);
    assertThat(mine(reader.collectForProjectAgent("RDD", agent), own))
        .extracting(SharedMemoryLine::content)
        .containsExactly("조직 규칙 D", "팀 규칙");
    assertThat(mine(reader.collectForProjectAgent(personal.key(), owner), own))
        .extracting(SharedMemoryLine::content)
        .containsExactly("조직 규칙 D");
  }

  @Test
  void 공간이_없으면_조직만() {
    long owner = user(dsl);
    repo.insert(SpaceKey.of("ORG", null), "조직 규칙 N", "USER_ADDED", owner, owner, t0);
    SharedMemories m = reader.collectForUser(owner, null);
    assertThat(m.items()).extracting(SharedMemoryLine::space).containsOnly("조직");
    assertThat(m.items()).extracting(SharedMemoryLine::content).contains("조직 규칙 N");
  }

  @Test
  void 토큰_추정은_비면_0() {
    assertThat(SharedAiMemoryEntryReader.estimateTokens(SharedMemories.EMPTY)).isZero();
    assertThat(
            SharedAiMemoryEntryReader.estimateTokens(
                new SharedMemories(List.of(new SharedMemoryLine("조직", "가나다")), 0)))
        .isPositive();
  }
}
