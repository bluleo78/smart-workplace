import java.io.File
import java.util.Properties

// jOOQ 코드젠을 커스텀 태스크에서 GenerationTool 로 직접 호출하기 위한 buildscript 의존.
// nu.studer.jooq 는 JDBC URL 을 config-time @Input 으로 고정해 throwaway 컨테이너의
// 동적 URL 을 execution-time 에 주입할 수 없어 사용하지 않는다.
buildscript {
    repositories { mavenCentral() }
    dependencies {
        // Testcontainers 2 아티팩트 이름(testcontainers-*)·버전을 테스트 의존성(Boot 4.0.9 BOM = 2.0.5)과 맞춘다(WP-1588).
        // buildscript 는 BOM 을 받지 않아 버전을 직접 적는다 — BOM 의 testcontainers.version 이 바뀌면 함께 올린다.
        classpath("org.testcontainers:testcontainers-postgresql:2.0.5")
        classpath("org.flywaydb:flyway-core:11.20.3")
        classpath("org.flywaydb:flyway-database-postgresql:11.20.3")
        classpath("org.postgresql:postgresql:42.7.4")
        classpath("org.jooq:jooq-codegen:3.19.35")
    }
}

plugins {
    java
    id("org.springframework.boot") version "4.0.9"
    id("io.spring.dependency-management") version "1.1.7"
    id("com.diffplug.spotless") version "6.25.0"
    jacoco
}

// JaCoCo — 로컬 리포트 전용. 0.8.13: Java 25(class major version 69) 지원
jacoco {
    toolVersion = "0.8.13"
}

group = "com.workplace"
version = "0.0.1-SNAPSHOT"

// Flyway 를 Spring Boot BOM(4.0.9 = 11.14.1)이 아니라 11.20.3 으로 고정한다 (postgres 18):
// PG18 정식 지원은 Flyway 11.20+ 부터라 BOM 버전은 "support has not been tested" 경고를 낸다.
// Flyway 12 는 Boot 4.0 대상이 아니라(WP-1588 범위 밖) 11.x 최신 수정판에 머문다.
// jOOQ 코드 생성 buildscript 의 flyway-core 버전과 맞춘다.
extra["flyway.version"] = "11.20.3"

// 운영 이미지 trivy 검사(WP-1570·WP-1571)에서 나온 취약 의존성을 Spring Boot BOM 보다 높은 수정판으로 고정한다.
// Boot BOM 이 이 버전 이상으로 올라오면 해당 줄을 지운다.
// Boot 4.0.9(WP-1588)로 올리며 아래 고정은 지웠다.
// - Tomcat: Boot 4 는 Tomcat 11 이라 옛 10.1.59 고정을 그대로 쓸 수 없다. BOM 의 11.0.27 을 쓴다(운영 이미지 trivy 로 재확인).
// - Jackson 2: Boot 4 BOM 의 jackson-2-bom 이 이미 2.21.7 이다(jackson-bom 속성은 이제 Jackson 3 을 가리킨다).
// - PostgreSQL JDBC: BOM 이 42.7.14 라 옛 고정(42.7.12)이 오히려 버전을 내린다.
// HttpCore5 5.4.3 — httpcore5·httpcore5-h2 HIGH(링크 미리보기 HttpClient5 가 쓴다). Boot 4.0.9 BOM 은 5.3.6.
extra["httpcore5.version"] = "5.4.3"

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

repositories {
    mavenCentral()
}

// Jackson 3(tools.jackson)을 classpath 에서 뺀다(WP-1588). Boot 4 의 web·webmvc·restclient 스타터가 spring-boot-starter-jackson 으로
// Jackson 3 을 끌어오는데, 정적 RestClient.builder()·new RestTemplate() 는 Boot 설정(preferred-json-mapper)을 거치지 않고
// classpath 에 Jackson 3 이 있으면 그것을 먼저 고른다. 그러면 내부·외부 호출 응답을 Jackson 3 기본값(null → 기본형 실패 등)으로 읽어
// Boot 3.5 때 잘 읽던 응답이 조용히 예외가 된다(OutboundJsonMapperTest). Jackson 2 를 유일한 매퍼로 두어 그 경로를 원천 차단한다.
// Jackson 3 으로 전환할 때 이 제외를 지운다.
configurations.all {
    exclude(group = "org.springframework.boot", module = "spring-boot-starter-jackson")
    exclude(group = "org.springframework.boot", module = "spring-boot-jackson")
    exclude(group = "tools.jackson.core")
}

dependencies {
    compileOnly("org.projectlombok:lombok:1.18.44")
    annotationProcessor("org.projectlombok:lombok:1.18.44")
    testCompileOnly("org.projectlombok:lombok:1.18.44")
    testAnnotationProcessor("org.projectlombok:lombok:1.18.44")

    implementation("org.springframework.boot:spring-boot-starter-web")
    // AI 작업 화면(WP-1277) — 관리자 브라우저와 runner 사이 터미널 중계. STOMP 없이 평범한 WebSocket 처리기만 쓴다.
    implementation("org.springframework.boot:spring-boot-starter-websocket")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-jooq")
    implementation("org.springframework.boot:spring-boot-starter-security")
    // WP-48 SSO — id_token 서명 검증(NimbusJwtDecoder)만 사용한다. oauth2Login() 은 서버 세션 전제라 쓰지 않는다.
    implementation("org.springframework.security:spring-security-oauth2-jose")
    // SMTP 테스트(설정 UI) — settings 모듈 SMTP 검증 엔드포인트
    implementation("org.springframework.boot:spring-boot-starter-mail")
    // Boot 4 모듈 분리(WP-1588)로 기존 스타터가 더는 끌어오지 않는 것들을 직접 선언한다.
    // - angus-mail: Jakarta Mail 구현체. 메일 수신(IMAP)·발송 코드가 직접 쓴다.
    // - starter-restclient: RestClient·RestTemplateBuilder·ClientHttpRequestFactoryBuilder 자동 구성이 별도 모듈로 나뉘었다.
    // - spring-boot-jackson2: Boot 4 기본은 Jackson 3 이다. Jackson 2 를 유지하므로(Jackson 3 전환은 범위 밖)
    //   Jackson 2 ObjectMapper 자동 구성·@JsonComponent 를 따로 넣는다. jsr310·jdk8·parameter-names 모듈은 이것이 함께 끌어온다.
    //   HTTP 변환기도 Jackson 2 를 쓰게 application.yml 에 spring.http.converters.preferred-json-mapper=jackson2 를 둔다.
    //   Jackson 3 자체는 위 configurations.all 에서 classpath 에서 뺀다.
    implementation("org.eclipse.angus:angus-mail")
    implementation("org.springframework.boot:spring-boot-starter-restclient")
    implementation("org.springframework.boot:spring-boot-jackson2")

    // JWT (jjwt)
    implementation("io.jsonwebtoken:jjwt-api:0.12.6")
    runtimeOnly("io.jsonwebtoken:jjwt-impl:0.12.6")
    runtimeOnly("io.jsonwebtoken:jjwt-jackson:0.12.6")

    // 반복 일정 RRULE(RFC 5545) 파싱/전개 — 회차 계산
    implementation("org.dmfs:lib-recur:0.17.1")

    // 스케줄러 분산 잠금(WP-165) — 롤링 배포로 api 파드가 겹치는 동안 @Scheduled 작업이 파드마다 동시에 도는 것을 막는다.
    // 7.x 가 Spring 7 / Boot 4 대응이다(6.x 는 Spring 6.2 / Boot 3.5 용, WP-1588 에서 올림).
    implementation("net.javacrumbs.shedlock:shedlock-spring:7.11.0")
    implementation("net.javacrumbs.shedlock:shedlock-provider-jdbc-template:7.11.0")

    // 채팅 링크 미리보기(WP-874) — 사용자가 적은 URL 을 서버가 대신 가져온다(SSRF 경로).
    // JDK HttpClient 는 이름 해석과 연결을 나눌 수 없어 검사한 IP 로 연결을 고정할 수 없다(DNS 재바인딩).
    // HttpClient5 는 DnsResolver 를 갈아끼울 수 있어 검사를 통과한 주소로만 소켓을 열면서 TLS SNI·호스트 검증은 그대로 둔다. 버전은 Boot BOM 관리.
    implementation("org.apache.httpcomponents.client5:httpclient5")
    // Open Graph 메타 추출용 HTML 파서(WP-874). BOM 비관리라 버전 고정.
    // 1.23.2 — 1.18.3 의 HIGH 취약점(운영 이미지 trivy 검사, WP-1571).
    implementation("org.jsoup:jsoup:1.23.2")
    // 프로필 아바타(WP-1222) — JDK ImageIO 는 WEBP 를 읽지 못한다. 읽기 전용 WEBP 플러그인(SPI 로 ImageIO 에 등록)만 더한다.
    // 쓰기는 PNG·JPEG(JDK 기본)로만 한다. BOM 비관리라 버전 고정.
    implementation("com.twelvemonkeys.imageio:imageio-webp:3.15.3")

    // 마이그레이션
    implementation("org.springframework.boot:spring-boot-starter-flyway")
    implementation("org.flywaydb:flyway-database-postgresql")

    // PostgreSQL driver — 런타임/jOOQ codegen 양쪽에서 필요
    implementation("org.postgresql:postgresql")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
    testImplementation("org.springframework.boot:spring-boot-starter-security-test")
    // 메일 연결 테스트용 임베디드 IMAP/SMTP 서버
    testImplementation("com.icegreen:greenmail-junit5:2.1.0")
    // 아키텍처 정적 검사 — 컨트롤러 Repository 직접 주입 시 @Transactional 강제(#640, RLS fail-closed 재발 방지)
    testImplementation("com.tngtech.archunit:archunit-junit5:1.3.0")
    // Testcontainers — 통합 테스트마다 격리된 Postgres(+pgvector) 컨테이너.
    // 버전은 Spring Boot 4.0.9 BOM 관리(Testcontainers 2.x). 2.x 부터 모듈 아티팩트 이름에 testcontainers- 접두사가 붙는다.
    testImplementation("org.springframework.boot:spring-boot-testcontainers")
    testImplementation("org.testcontainers:testcontainers-junit-jupiter")
    testImplementation("org.testcontainers:testcontainers-postgresql")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<Test> {
    useJUnitPlatform()
    // 테스트 워커 힙: Gradle 기본 512m 은 캐시된 Spring 컨텍스트 + 마지막 ArchUnit 전체 클래스 임포트에서
    // OOM("Java heap space")으로 워커가 죽는다(main 도 495~511M 로 한계). 여유를 두고 1.5g 로 올리고,
    // 재발 시 원인 분석용 힙 덤프를 남긴다.
    maxHeapSize = "1536m"
    jvmArgs("-XX:+HeapDumpOnOutOfMemoryError")
    // 테스트 클래스를 여러 JVM 포크로 나눠 병렬 실행(WP-114). 포크마다 Testcontainers DB·저장소 루트
    // (application-test.yml, worker 번호별)가 따로라 격리가 유지된다. JVM 내부 병렬은 쓰지 않는다 —
    // IntegrationTestBase 의 세션 GUC 리셋이 단일 스레드 실행을 전제로 한다.
    // 기본 2 — 포크마다 힙 1.5g + DB 컨테이너가 붙고 병렬 세션·E2E 와 머신을 나눠 쓰므로 과도하게 올리지 않는다.
    // -PtestForks=N 으로 조정(예: 디버깅 시 1).
    maxParallelForks = (findProperty("testForks") as String?)?.toInt() ?: 2
    // OrbStack: 기본 docker.sock 이 죽은 Docker Desktop 을 가리킬 때 Testcontainers 가 못 붙는다.
    // DOCKER_HOST 미설정 + OrbStack 소켓 존재 시 자동 주입(로컬 편의; 명시 설정이 있으면 존중).
    if (System.getenv("DOCKER_HOST") == null) {
        val orbSock = File(System.getProperty("user.home"), ".orbstack/run/docker.sock")
        if (orbSock.exists()) {
            environment("DOCKER_HOST", "unix://${orbSock.absolutePath}")
            environment("TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE", "/var/run/docker.sock")
        }
    }
    // pre-commit 이 변경분 기반으로 --tests 필터를 넘길 때, 매칭 테스트가 없어도 커밋이
    // 깨지지 않도록 한다(누락분은 pre-push 의 필터 없는 전체 test 가 잡는다).
    // 필터가 없는 전체 실행(pre-push)에는 영향 없음.
    filter { isFailOnNoMatchingTests = false }
    // 운영·bootRun 과 같은 UTC 기본 시간대로 테스트 JVM 을 띄운다(WP-939) — 테스트는 WorkplaceApplication.main 을
    // 거치지 않아 거기서 고정한 시간대가 적용되지 않는다. pgjdbc 가 이 값으로 DB 세션 TimeZone 을 맞춘다.
    systemProperty("user.timezone", "UTC")
    // JDK 25 + Mockito inline mock-maker + ByteBuddy 호환을 위한 JVM 옵션
    jvmArgs(
        "--add-opens", "java.base/java.lang=ALL-UNNAMED",
        "--add-opens", "java.base/java.lang.reflect=ALL-UNNAMED",
        "--add-opens", "java.base/java.util=ALL-UNNAMED",
        "-XX:+EnableDynamicAgentLoading",
        "-Dnet.bytebuddy.experimental=true"
    )
    // 테스트 완료 후 JaCoCo 리포트 자동 생성
    finalizedBy(tasks.jacocoTestReport)
    // 리포트를 빼는 실행(-x jacocoTestReport, push 검사)은 -PnoCoverage 로 계측 에이전트도 끈다(WP-1028) —
    // 리포트를 안 만들면 테스트 내내 모든 클래스를 계측하는 비용만 남는다.
    extensions.configure<JacocoTaskExtension> { isEnabled = !providers.gradleProperty("noCoverage").isPresent }
}

tasks.jacocoTestReport {
    dependsOn(tasks.test)
    reports {
        xml.required.set(true)
        html.required.set(true)
    }
    // 제외: jOOQ 코드젠 결과물, 단순 DTO/예외(생성자 위주라 의미있는 로직 없음)
    classDirectories.setFrom(
        files(
            classDirectories.files.map {
                fileTree(it) {
                    exclude(
                        "com/workplace/jooq/**",
                        "**/dto/**",
                        "**/*Exception.class",
                    )
                }
            }
        )
    )
}

// Spotless — Google Java Format
spotless {
    java {
        googleJavaFormat("1.34.1")
        target("src/main/java/**/*.java", "src/test/java/**/*.java")
        // jOOQ 코드젠 결과물 제외
        targetExclude("src/main/generated/**")
    }
}

// 생성된 jOOQ 소스를 일반 소스로 컴파일(플러그인 없이 sourceSet 직접 등록).
sourceSets {
    named("main") {
        java.srcDir("src/main/generated")
    }
}

// jOOQ codegen — throwaway pgvector/pgvector:pg18 컨테이너에 Flyway migrate 후 GenerationTool 로 생성.
// 로컬 DB 불필요(Docker 데몬만 필요). compileJava 에 의존을 걸지 않아 DB/Docker 없이 빌드 가능.
// 스키마 변경 후 명시적으로 `./gradlew generateJooq` 실행하고 결과를 커밋한다.
tasks.register("generateJooq") {
    group = "jooq"
    description = "throwaway Postgres 컨테이너에 마이그레이션 적용 후 jOOQ 코드 생성"
    val migrationDir =
        layout.projectDirectory.dir("src/main/resources/db/migration").asFile.absolutePath
    val outputDir = layout.projectDirectory.dir("src/main/generated").asFile.absolutePath
    doLast {
        // docker-java 기본 API 협상(1.32)은 OrbStack 등 모던 데몬이 거부 → 1.41 로 고정.
        System.setProperty("api.version", "1.41")
        // OrbStack: 이 태스크는 Gradle 데몬 안에서 포크 없이 직접 실행되므로(tasks.withType<Test> 의
        // environment("DOCKER_HOST", ...) 처럼 자식 프로세스 env 주입 방식은 여기서 통하지 않는다)
        // JVM 안에서 프로세스 환경변수를 바꿀 수 없다. Testcontainers 는 docker.host 를
        // ~/.testcontainers.properties 파일(TestcontainersConfiguration.USER_CONFIG_FILE)에서도 읽으므로,
        // DOCKER_HOST 미설정 + OrbStack 소켓 존재 시 이 파일에 한 번만 기록해 자동 인식되게 한다
        // (명시적으로 DOCKER_HOST 를 설정한 경우는 건드리지 않음 — env 가 이 파일보다 우선한다).
        if (System.getenv("DOCKER_HOST") == null) {
            val orbSock = File(System.getProperty("user.home"), ".orbstack/run/docker.sock")
            if (orbSock.exists()) {
                val userConfigFile = File(System.getProperty("user.home"), ".testcontainers.properties")
                val props = Properties()
                if (userConfigFile.exists()) {
                    userConfigFile.inputStream().use { props.load(it) }
                }
                if (props.getProperty("docker.host") == null) {
                    props.setProperty("docker.host", "unix://${orbSock.absolutePath}")
                    userConfigFile.outputStream().use {
                        props.store(it, "smart-workplace: OrbStack 자동 감지(generateJooq)")
                    }
                }
            }
        }
        val container =
            org.testcontainers.postgresql.PostgreSQLContainer("pgvector/pgvector:pg18")
                .withDatabaseName("workplace_test")
                .withUsername("app")
                .withPassword("app")
        container.start()
        try {
            // Flyway 는 소유자 롤(app)로 실행 — CREATE ROLE app_tenant / GRANT 가능.
            org.flywaydb.core.Flyway.configure()
                .dataSource(container.jdbcUrl, container.username, container.password)
                .locations("filesystem:$migrationDir")
                .load()
                .migrate()

            val configuration =
                org.jooq.meta.jaxb.Configuration()
                    .withJdbc(
                        org.jooq.meta.jaxb.Jdbc()
                            .withDriver("org.postgresql.Driver")
                            .withUrl(container.jdbcUrl)
                            .withUser(container.username)
                            .withPassword(container.password)
                    )
                    .withGenerator(
                        org.jooq.meta.jaxb.Generator()
                            .withName("org.jooq.codegen.DefaultGenerator")
                            .withDatabase(
                                org.jooq.meta.jaxb.Database()
                                    .withName("org.jooq.meta.postgres.PostgresDatabase")
                                    .withInputSchema("public")
                                    .withExcludes("flyway_schema_history")
                                    // DB 함수(루틴·테이블 값 함수)는 생성하지 않는다(WP-86). citext 등 확장의 같은 이름
                                    // 오버로드(regexp_split_to_table 2·3인자)를 jOOQ 가 카탈로그 순서대로 골라 재생성마다
                                    // 결과가 바뀌어 커밋 훅 diff 검사가 헛경보를 냈다. 함수는 SQL 문자열로만 호출하므로 불필요.
                                    .withIncludeRoutines(false)
                                    .withTableValuedFunctions(false)
                            )
                            .withTarget(
                                org.jooq.meta.jaxb.Target()
                                    .withPackageName("com.workplace.jooq")
                                    .withDirectory(outputDir)
                            )
                    )
            org.jooq.codegen.GenerationTool.generate(configuration)
        } finally {
            container.stop()
        }
    }
}

