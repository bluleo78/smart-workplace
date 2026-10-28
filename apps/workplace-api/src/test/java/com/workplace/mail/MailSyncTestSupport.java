package com.workplace.mail;

import com.workplace.mail.service.MailBackfillService;
import com.workplace.mail.service.MailSummaryBackfillService;
import com.workplace.support.ExternalClientMockedTestBase;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * 메일 동기화 흐름을 시험하는 통합 테스트 기반(WP-1028).
 *
 * <p>동기화가 끝나면 본문 보충({@link MailBackfillService})과 선제 요약({@link MailSummaryBackfillService})이 비동기로
 * 뒤따른다. 동기화 결과만 보는 테스트가 그 뒷일까지 기다리지 않도록 두 서비스를 목으로 바꾼다. 클래스마다 둘 중 하나만 목으로 바꾸면 그 조합마다 Spring 컨텍스트가
 * 갈리므로 여기서 한 벌로 둔다. 호출 여부는 {@code @Autowired} 로 받아 확인한다.
 */
@MockitoBean(types = {MailBackfillService.class, MailSummaryBackfillService.class})
public abstract class MailSyncTestSupport extends ExternalClientMockedTestBase {}
