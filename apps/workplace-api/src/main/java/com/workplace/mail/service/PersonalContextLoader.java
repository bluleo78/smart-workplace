package com.workplace.mail.service;

import com.workplace.mail.dto.SenderRelation;
import com.workplace.mail.dto.UserMailProfile;
import com.workplace.mail.outbound.MailAiMessages.Sender;
import com.workplace.mail.repository.EmailMessageRepository.AnalysisContext;
import java.util.List;
import java.util.function.Supplier;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * ④ 개인 분석 보강 입력 조회(WP-150) — 보낸 사람 관계(이후 Task 에서 이전 메일·연결 이슈·첨부 추가).
 *
 * <p>블록마다 자기 짧은 트랜잭션(RLS GUC 주입)에서 읽는다. Postgres 는 실패한 문장 뒤 같은 트랜잭션을 못 쓰므로, 한 트랜잭션 안의 try/catch 로는
 * 뒤 블록까지 모두 실패한다. 실패한 블록은 경고 로그 후 null(목록은 빈 목록)로 두고 분석은 계속한다(스펙 오류 처리 표 첫 행).
 */
@Slf4j
@Component
public class PersonalContextLoader {

  private final SenderRelationResolver relationResolver;
  private final TransactionTemplate txTemplate;

  public PersonalContextLoader(
      SenderRelationResolver relationResolver, PlatformTransactionManager txManager) {
    this.relationResolver = relationResolver;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /**
   * 보강 입력 조회. ctx 는 소유 검증된 분석 컨텍스트(findAnalysisContextByIdAndUser)다.
   *
   * @param userId 사본 소유자(스레드 조회의 소유 검증용 — Task 4)
   */
  public PersonalContext load(long userId, AnalysisContext ctx, UserMailProfile me) {
    Sender sender =
        block(
            "보낸 사람 관계",
            ctx.messageId(),
            () -> toWire(relationResolver.resolve(me, ctx.fromAddress())));
    return new PersonalContext(sender, List.of(), null, List.of());
  }

  /** 블록 하나를 자기 트랜잭션에서 조회. 실패하면 null. */
  private <T> T block(String label, long messageId, Supplier<T> query) {
    try {
      return txTemplate.execute(status -> query.get());
    } catch (RuntimeException e) {
      log.warn("개인 분석 입력에서 {} 블록을 뺌 (messageId={}): {}", label, messageId, e.toString());
      return null;
    }
  }

  /** 관계 → 와이어. 렌더(줄바꿈 접기 포함)는 agent 가 한다. */
  static Sender toWire(SenderRelation r) {
    return new Sender(
        r.kind().name(), r.name(), r.title(), r.organization(), r.sameGroups(), r.favorite());
  }
}
