package com.workplace.home.service;

import static com.workplace.jooq.Tables.AI_MEMORY;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doCallRealMethod;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;

import com.workplace.global.ai.AiMemoryLine;
import com.workplace.global.ai.AiMemoryReader;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.dto.CreateAiMemoryRequest;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.service.AiPreferenceService;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-381: 다른 진입점용 읽기 전용 메모리 — 공통 + 그 앱만(다른 앱 제외), 범위·기한을 와이어 줄로, 꺼짐이면 빈 목록. 조회가 실패해도 예외 없이 빈 목록이고
 * 트랜잭션이 스레드에 남지 않으며, 바깥 트랜잭션 안에서 불려도 그 트랜잭션을 rollback-only 로 만들지 않는다. 리더가 스스로 새 읽기 트랜잭션을 열므로 시드는
 * 커밋한다(@Transactional 없음).
 *
 * <p>실패는 loadForChat 의 @Transactional 경계 <b>안쪽</b>(AiPreferenceService.memoryEnabled)에서 던진다 — 읽기
 * 트랜잭션이 실제로 롤백되는 경로를 타야 그 뒤 스레드 상태·바깥 커밋을 확인하는 의미가 있다(경계 밖에서 던지면 별도 트랜잭션이 아니어도 통과한다).
 */
class AiMemoryEntryReaderTest extends IntegrationTestBase {

  @Autowired AiMemoryReader reader;
  @Autowired AiMemoryService memoryService;
  @MockitoSpyBean AiPreferenceService preferences;

  private final List<Long> users = new ArrayList<>();

  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    cleanupInTenant(
        1L, () -> baseDsl.deleteFrom(AI_MEMORY).where(AI_MEMORY.USER_ID.in(users)).execute());
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
  }

  private long user() {
    long uid = TestFixtures.createHuman(baseDsl);
    users.add(uid);
    return uid;
  }

  @Test
  void 공통과_그_앱만_범위와_기한을_실어_돌려준다() {
    long uid = user();
    memoryService.create(
        uid, new CreateAiMemoryRequest("PREFERENCE", "답은 존댓말로", null, null, null, null), false);
    memoryService.create(
        uid,
        new CreateAiMemoryRequest("PREFERENCE", "메일은 세 줄로", null, null, "MAIL", "2999-12-31"),
        false);
    memoryService.create(
        uid, new CreateAiMemoryRequest("PREFERENCE", "이슈는 짧게", null, null, "ISSUE", null), false);

    List<AiMemoryLine> lines = reader.readForEntry(uid, AiMemoryReader.MAIL);

    assertThat(lines).extracting(AiMemoryLine::content).containsExactly("메일은 세 줄로", "답은 존댓말로");
    assertThat(lines.get(0).scope()).isEqualTo("MAIL");
    assertThat(lines.get(0).expiresOn()).isEqualTo("2999-12-31");
    assertThat(lines.get(1).scope()).isNull();
    assertThat(lines.get(1).expiresOn()).isNull();
  }

  /** 메모리가 있어도 꺼져 있으면 싣지 않는다 — 먼저 1건을 읽어 보여, 빈 결과가 빈 테이블이 아니라 꺼짐 스위치 때문임을 증명한다. */
  @Test
  void 꺼져_있으면_빈_목록() {
    long uid = user();
    memoryService.create(
        uid, new CreateAiMemoryRequest("PREFERENCE", "노트는 개조식으로", null, null, null, null), false);
    assertThat(reader.readForEntry(uid, AiMemoryReader.WIKI)).hasSize(1);

    doReturn(false).when(preferences).memoryEnabled(anyLong());

    assertThat(reader.readForEntry(uid, AiMemoryReader.WIKI)).isEmpty();
  }

  /** 조회가 실패해도 빈 목록이고, 트랜잭션이 스레드에 남지 않아 실패가 풀린 뒤의 다음 조회는 정상으로 읽는다. */
  @Test
  void 조회가_실패해도_빈_목록이고_다음_조회는_정상이다() {
    long uid = user();
    memoryService.create(
        uid, new CreateAiMemoryRequest("PREFERENCE", "요약은 세 줄로", null, null, null, null), false);
    assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
    doThrow(new IllegalStateException("db down")).when(preferences).memoryEnabled(anyLong());

    assertThat(reader.readForEntry(uid, AiMemoryReader.MESSAGING)).isEmpty();
    assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();

    doCallRealMethod().when(preferences).memoryEnabled(anyLong());
    assertThat(reader.readForEntry(uid, AiMemoryReader.MESSAGING))
        .extracting(AiMemoryLine::content)
        .containsExactly("요약은 세 줄로");
  }

  /**
   * 바깥 readOnly 트랜잭션 안에서 조회가 실패해도 빈 목록이고, 바깥 커밋이 UnexpectedRollbackException 없이 끝난다 — 리더가 바깥에 참여하면
   * 실패가 바깥을 rollback-only 로 만들고 리더는 예외를 삼키므로 바깥 커밋에서 기능 전체가 실패한다.
   */
  @Test
  void 바깥_트랜잭션_안에서_조회가_실패해도_바깥은_그대로_커밋된다() {
    long uid = user();
    doThrow(new IllegalStateException("db down")).when(preferences).memoryEnabled(anyLong());
    TransactionTemplate outer = new TransactionTemplate(txManager);
    outer.setReadOnly(true);

    List<AiMemoryLine> lines =
        outer.execute(s -> reader.readForEntry(uid, AiMemoryReader.MESSAGING));

    assertThat(lines).isEmpty();
  }
}
