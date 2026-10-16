package com.workplace.home.service;

import com.workplace.global.ai.SharedAiMemoryReader;
import com.workplace.global.ai.SharedMemories;
import com.workplace.global.ai.SharedMemoryLine;
import com.workplace.global.util.TokenEstimates;
import com.workplace.home.repository.SharedAiMemoryRepository;
import com.workplace.home.repository.SharedAiMemoryRepository.Row;
import com.workplace.home.repository.SharedMemorySpaceRepository;
import com.workplace.home.service.SharedSpace.SpaceKey;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.ArrayList;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 공용 메모리 읽기(WP-386 스펙 5.1) — 조직 → 공간 순, 공간 안에서는 updated_at 최신순으로 2,000토큰 예산 안에서 채우고, 처음 넘치는 줄부터는
 * 개수만 센다(순서를 지키려고 뒤의 짧은 줄로 메우지 않는다). 권한은 요청마다 SharedMemorySpaces 로 다시 본다. 실패하면 빈 묶음 — 로그에 사용자 id 를
 * 싣지 않는다.
 */
@Slf4j
@Component
public class SharedAiMemoryEntryReader implements SharedAiMemoryReader {

  /** 공용 블록 예산(토큰). */
  public static final int BUDGET_TOKENS = 2_000;

  /** 블록 머리(제목·안내·우선순위 문장, 한글 약 120자) 근사 토큰. ai-agent shared-memory-block.ts 문구가 바뀌면 함께 본다. */
  static final int HEADER_TOKENS = 120;

  /** 줄마다 "- [" "] " 접두 근사. */
  static final int LINE_OVERHEAD_TOKENS = 6;

  /** 「이 밖에 공용 메모리 n개」 줄 근사. */
  static final int MORE_LINE_TOKENS = 30;

  private final SharedMemorySpaces spaces;
  private final SharedAiMemoryRepository repo;
  private final SharedMemorySpaceRepository spaceRepo;
  private final ProjectAccessGuard projectAccess;
  private final TransactionTemplate tx;

  public SharedAiMemoryEntryReader(
      SharedMemorySpaces spaces,
      SharedAiMemoryRepository repo,
      SharedMemorySpaceRepository spaceRepo,
      ProjectAccessGuard projectAccess,
      PlatformTransactionManager txManager) {
    this.spaces = spaces;
    this.repo = repo;
    this.spaceRepo = spaceRepo;
    this.projectAccess = projectAccess;
    // 호출자 트랜잭션과 무관하게 새 읽기 전용 트랜잭션 — 펌프 스레드처럼 트랜잭션이 없는 곳에서도 테넌트 GUC 가 잡힌다.
    this.tx = new TransactionTemplate(txManager);
    this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    this.tx.setReadOnly(true);
  }

  @Override
  public SharedMemories readForUser(long userId, String spaceType, Long spaceId) {
    SpaceKey k = spaceType == null ? null : SpaceKey.of(spaceType, spaceId);
    try {
      SharedMemories m = tx.execute(s -> collectForUser(userId, k));
      return m == null ? SharedMemories.EMPTY : m;
    } catch (RuntimeException e) {
      log.warn("공용 메모리 읽기 실패 — 빈 블록으로 진행: {}", e.getClass().getSimpleName());
      return SharedMemories.EMPTY;
    }
  }

  @Override
  public SharedMemories readForProjectAgent(String projectKey, long agentUserId) {
    try {
      SharedMemories m = tx.execute(s -> collectForProjectAgent(projectKey, agentUserId));
      return m == null ? SharedMemories.EMPTY : m;
    } catch (RuntimeException e) {
      log.warn("공용 메모리 읽기 실패(이벤트) — 빈 블록으로 진행: {}", e.getClass().getSimpleName());
      return SharedMemories.EMPTY;
    }
  }

  /** 현재 트랜잭션에서 — 조직 + (읽을 수 있으면) 그 공간. ORG 를 넘기면 조직만. */
  SharedMemories collectForUser(long userId, SpaceKey k) {
    List<SharedMemoryLine> lines =
        new ArrayList<>(lines(SharedSpace.org(), repo.all(SpaceKey.of("ORG", null))));
    if (k != null && !"ORG".equals(k.type())) {
      spaces
          .access(userId, k)
          .filter(SharedMemorySpaces.Access::canRead)
          .ifPresent(a -> lines.addAll(lines(a.space(), repo.all(k))));
    }
    return fit(lines);
  }

  /** 현재 트랜잭션에서 — 조직 + TEAM·OPEN 이고 에이전트가 읽을 수 있는 프로젝트. */
  SharedMemories collectForProjectAgent(String projectKey, long agentUserId) {
    List<SharedMemoryLine> lines =
        new ArrayList<>(lines(SharedSpace.org(), repo.all(SpaceKey.of("ORG", null))));
    if (projectKey != null) {
      spaceRepo
          .projectByKey(projectKey)
          .filter(p -> "TEAM".equals(p.type()) || "OPEN".equals(p.type()))
          .filter(p -> projectAccess.canRead(p.id(), agentUserId))
          .ifPresent(
              p ->
                  lines.addAll(
                      lines(
                          new SharedSpace(SharedSpace.Type.PROJECT, p.id(), p.key(), p.name()),
                          repo.all(SpaceKey.of("PROJECT", p.id())))));
    }
    return fit(lines);
  }

  private static List<SharedMemoryLine> lines(SharedSpace space, List<Row> rows) {
    return rows.stream().map(r -> new SharedMemoryLine(space.label(), r.content())).toList();
  }

  /** 예산 안에서 앞에서부터 — 처음 넘치는 줄부터는 개수만. */
  static SharedMemories fit(List<SharedMemoryLine> lines) {
    if (lines.isEmpty()) return SharedMemories.EMPTY;
    int budget = BUDGET_TOKENS - HEADER_TOKENS - MORE_LINE_TOKENS;
    int used = 0;
    int i = 0;
    for (; i < lines.size(); i++) {
      int t = lineTokens(lines.get(i));
      if (used + t > budget) break;
      used += t;
    }
    return new SharedMemories(List.copyOf(lines.subList(0, i)), lines.size() - i);
  }

  static int lineTokens(SharedMemoryLine l) {
    return TokenEstimates.estimate(l.content())
        + TokenEstimates.estimate(l.space())
        + LINE_OVERHEAD_TOKENS;
  }

  /** 블록 근사 토큰 — 비었으면 0(홈 채팅 예산 맞춤에 개인 블록 몫과 함께 뺀다). */
  public static int estimateTokens(SharedMemories m) {
    if (m.items().isEmpty() && m.moreCount() == 0) return 0;
    int sum = HEADER_TOKENS + (m.moreCount() > 0 ? MORE_LINE_TOKENS : 0);
    for (SharedMemoryLine l : m.items()) sum += lineTokens(l);
    return sum;
  }
}
