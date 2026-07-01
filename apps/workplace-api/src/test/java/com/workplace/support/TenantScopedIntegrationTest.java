package com.workplace.support;

import com.workplace.global.tenant.TenantContext;
import org.springframework.test.context.transaction.AfterTransaction;
import org.springframework.test.context.transaction.BeforeTransaction;

/**
 * OPEN 프로젝트 유형 등 RLS 테이블을 시딩하는 @Transactional 통합 테스트의 공통 기반 클래스.
 *
 * <p>문제: Spring @Transactional 테스트는 테스트 트랜잭션이 JUnit의 @BeforeEach 보다 먼저 시작된다.
 * TenantAwareTransactionManager.doBegin()은 트랜잭션 시작 시점에 TenantContext.get()을 읽어 app.tenant_id GUC를
 * set_config(..., true)로 주입한다. 따라서 @BeforeEach에서 TenantContext.set()을 호출하면 doBegin()이 이미 완료된 뒤라
 * GUC가 누락된 채 트랜잭션이 열린다. 결과적으로 RLS WITH CHECK 위반으로 seed INSERT가 실패하고, 직전 테스트가 TenantContext를 남긴 경우에만
 * 통과하는 순서 의존 flaky가 발생한다 (#512 계열).
 *
 * <p>해결: @BeforeTransaction은 Spring이 테스트 트랜잭션을 시작하기 전에 실행되므로, 이 시점에 TenantContext.set(1L)을 호출하면
 * doBegin()이 올바른 테넌트 ID를 읽어 GUC를 주입한다.
 */
public abstract class TenantScopedIntegrationTest extends IntegrationTestBase {

  /** 테스트 트랜잭션 시작 전 테넌트 컨텍스트를 주입 — doBegin GUC 시딩 타이밍 보장. */
  @BeforeTransaction
  public void setTenantBeforeTx() {
    TenantContext.set(1L);
  }

  /** 테스트 트랜잭션 종료 후 테넌트 컨텍스트를 정리 — 테스트 간 컨텍스트 누수 방지. */
  @AfterTransaction
  public void clearTenantAfterTx() {
    TenantContext.clear();
  }
}
