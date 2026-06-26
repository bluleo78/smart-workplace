package com.workplace.messaging;

import static com.workplace.jooq.Tables.CONVERSATION_ATTENTION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.outbound.AiAgentMessagingClient;
import com.workplace.messaging.outbound.dto.MessagingClassifyResult;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.repository.MessageRepository;
import com.workplace.messaging.service.MessagingAttentionService;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * async fan-out RLS 격리 가드 — tenant 1 채널 분류가 다른 tenant GUC 컨텍스트에서 비가시임을 검증.
 *
 * <p>비-@Transactional 클래스: onChannelMessageSync 가 자체 트랜잭션을 열어 실제 커밋·GUC 주입 경로를 태운다. (#444 교훈) 테스트
 * 하니스 세션 GUC=1 마스킹 주의 — 존재하지 않는 대체 tenant ID(999999)로 GUC 를 전환해 격리 검증. (app_tenant 롤은 tenant 행
 * DELETE 불가이므로 INSERT 없이 non-existent ID 사용.)
 */
@SpringBootTest
@ActiveProfiles("test")
class MessagingAttentionRlsTest {

  /** 존재하지 않는 tenant ID — RLS 격리 증명용 (app_tenant 는 tenant DELETE 불가이므로 INSERT 회피). */
  private static final long PHANTOM_TENANT_ID = 999_999L;

  @Autowired private MessagingAttentionService svc;
  @MockBean private AiAgentMessagingClient aiClient;
  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;
  @Autowired private ChannelRepository channelRepo;
  @Autowired private ChannelMemberRepository memberRepo;
  @Autowired private MessageRepository messageRepo;

  /** 테스트가 생성한 채널 ID — @AfterEach 에서 정리 대상. */
  private Long testChannelId;

  /** 테스트 데이터 정리: tenant 1 GUC 로 conversation_attention 삭제 후 채널(CASCADE 포함) 삭제. */
  @AfterEach
  void cleanup() {
    if (testChannelId == null) return;
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              // conversation_attention 은 channel 에 FK CASCADE 없으므로 명시 삭제
              setGuc(1L);
              dsl.deleteFrom(CONVERSATION_ATTENTION)
                  .where(CONVERSATION_ATTENTION.CHANNEL_ID.eq(testChannelId))
                  .execute();
              // channel_member / message 는 channel 삭제 시 CASCADE 로 제거됨
              channelRepo.hardDelete(testChannelId);
            });
    TenantContext.clear();
  }

  /**
   * tenant 1 채널 fan-out 분류가 다른 tenant GUC 컨텍스트(PHANTOM_TENANT_ID)에서 격리됨을 검증.
   *
   * <p>절차: 1) tenant 1 GUC 로 채널·멤버·메시지 시드 (커밋) 2) aiClient 스텁 — 멤버 userId 를 relevant 로 반환 3)
   * TenantContext=1 설정 → onChannelMessageSync 호출 → 자체 tx 커밋 4) GUC=1 → conversation_attention 1행 확인
   * 5) GUC=PHANTOM_TENANT_ID → conversation_attention 0행 확인 (RLS 격리)
   */
  @Test
  void tenant1_분류는_tenant1_행만_생성_타_tenant_격리() {
    // ── 1) tenant 1 GUC 로 채널·멤버·메시지 시드 (별도 커밋)
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 6);
    long memberId =
        new TransactionTemplate(txManager)
            .execute(
                status -> {
                  setGuc(1L);
                  // 채널 소유자 생성
                  long ownerId = insertUser("owner", suffix + "o");
                  // PUBLIC 채널 생성 (RLS WITH CHECK → tenant_id=1 자동 주입)
                  long chId = channelRepo.insertPublic("attn-rls-" + suffix, ownerId);
                  testChannelId = chId;
                  // 멤버: 이름 "동희" → 이름 프리필터 토큰("동희") 매칭
                  long uid = insertUser("동희", suffix + "m");
                  memberRepo.add(chId, uid, "MEMBER");
                  // 메시지 작성자 추가
                  long authorId = insertUser("김PM", suffix + "a");
                  memberRepo.add(chId, authorId, "MEMBER");
                  // 이름 토큰 "동희" 포함 메시지 → 프리필터 통과 → AI 호출 경로 진입
                  messageRepo.insert(chId, authorId, "동희가 배포 확인했나요?", List.of(), null);
                  return uid;
                });

    // ── 2) aiClient 스텁: memberId 를 relevant 로 반환
    when(aiClient.classify(any()))
        .thenReturn(
            new MessagingClassifyResult(
                List.of(new MessagingClassifyResult.Relevant(memberId, "배포 여부 질문"))));

    // ── 3) TenantContext=1 설정 후 동기 본체 직접 호출 — 내부에서 자체 tx 열고 커밋
    //    TenantAwareTransactionManager 가 doBegin 시점에 TenantContext 를 읽어 GUC 주입
    //    (트리거 메시지 id 는 본체가 maxMessageId 로 재조회하므로 인자로 넘기지 않는다.)
    TenantContext.set(1L);
    svc.onChannelMessageSync(testChannelId);

    // ── 4) GUC=1 → conversation_attention 에 1행 기록 확인
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              setGuc(1L);
              int cnt =
                  dsl.fetchCount(
                      dsl.selectFrom(CONVERSATION_ATTENTION)
                          .where(CONVERSATION_ATTENTION.CHANNEL_ID.eq(testChannelId)));
              assertThat(cnt).as("tenant 1 GUC → conversation_attention 1행 기대").isEqualTo(1);
            });

    // ── 5) GUC=PHANTOM_TENANT_ID → 0행 확인 (RLS USING 차단: tenant_id=1 행이 비가시)
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              setGuc(PHANTOM_TENANT_ID);
              int cnt =
                  dsl.fetchCount(
                      dsl.selectFrom(CONVERSATION_ATTENTION)
                          .where(CONVERSATION_ATTENTION.CHANNEL_ID.eq(testChannelId)));
              assertThat(cnt).as("다른 tenant GUC → conversation_attention 0행 기대(RLS 격리)").isZero();
            });
  }

  // ── 헬퍼 ────────────────────────────────────────────────

  /** 트랜잭션-로컬 GUC 설정 (is_local=true → tx 종료 시 자동 리셋). */
  private void setGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  /** UUID suffix 유니크 유저 INSERT 후 ID 반환. 호출 시 GUC 가 이미 설정된 트랜잭션 안에서 실행되어야 RLS WITH CHECK 통과. */
  private long insertUser(String name, String suffix) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, name + "_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, name)
        .set(USER.EMAIL, name + "_" + suffix + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }
}
