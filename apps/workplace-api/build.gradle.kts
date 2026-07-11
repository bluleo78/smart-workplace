import java.io.File
import java.util.Properties

// jOOQ 코드젠을 커스텀 태스크에서 GenerationTool 로 직접 호출하기 위한 buildscript 의존.
// nu.studer.jooq 는 JDBC URL 을 config-time @Input 으로 고정해 throwaway 컨테이너의
// 동적 URL 을 execution-time 에 주입할 수 없어 사용하지 않는다.
buildscript {
    repositories { mavenCentral() }
    dependencies {
        classpath("org.testcontainers:postgresql:1.20.4")
        classpath("org.flywaydb:flyway-core:11.20.3")
        classpath("org.flywaydb:flyway-database-postgresql:11.20.3")
        classpath("org.postgresql:postgresql:42.7.4")
        classpath("org.jooq:jooq-codegen:3.19.35")
    }
}

plugins {
    java
    id("org.springframework.boot") version "3.5.16"
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

// Flyway 를 Spring Boot BOM(3.5.x = 11.7)이 아니라 11.20.3 으로 고정한다 (postgres 18):
// PG18 정식 지원은 Flyway 11.20+ 부터이고(11.7/BOM 은 "support has not been tested" 경고),
// Flyway 12 는 Spring Boot 3.x 의 FlywayAutoConfiguration 과 비호환이다(cleanOnValidationError
// 제거 → NoSuchMethodError). 11.20.3 은 PG18 지원 + Flyway 11 API 유지로 둘 다 만족한다.
extra["flyway.version"] = "11.20.3"

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

repositories {
    mavenCentral()
}

dependencies {
    compileOnly("org.projectlombok:lombok:1.18.44")
    annotationProcessor("org.projectlombok:lombok:1.18.44")
    testCompileOnly("org.projectlombok:lombok:1.18.44")
    testAnnotationProcessor("org.projectlombok:lombok:1.18.44")

    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-jooq")
    implementation("org.springframework.boot:spring-boot-starter-security")
    // SMTP 테스트(설정 UI) — settings 모듈 SMTP 검증 엔드포인트
    implementation("org.springframework.boot:spring-boot-starter-mail")

    // JWT (jjwt)
    implementation("io.jsonwebtoken:jjwt-api:0.12.6")
    runtimeOnly("io.jsonwebtoken:jjwt-impl:0.12.6")
    runtimeOnly("io.jsonwebtoken:jjwt-jackson:0.12.6")

    // 반복 일정 RRULE(RFC 5545) 파싱/전개 — 회차 계산
    implementation("org.dmfs:lib-recur:0.17.1")

    // 마이그레이션
    implementation("org.flywaydb:flyway-core")
    implementation("org.flywaydb:flyway-database-postgresql")

    // PostgreSQL driver — 런타임/jOOQ codegen 양쪽에서 필요
    implementation("org.postgresql:postgresql")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.security:spring-security-test")
    // 메일 연결 테스트용 임베디드 IMAP/SMTP 서버
    testImplementation("com.icegreen:greenmail-junit5:2.1.0")
    // 아키텍처 정적 검사 — 컨트롤러 Repository 직접 주입 시 @Transactional 강제(#640, RLS fail-closed 재발 방지)
    testImplementation("com.tngtech.archunit:archunit-junit5:1.3.0")
    // Testcontainers — 통합 테스트마다 격리된 Postgres(+pgvector) 컨테이너.
    // 버전은 Spring Boot 3.5.16 BOM(spring-boot-testcontainers) 관리.
    testImplementation("org.springframework.boot:spring-boot-testcontainers")
    testImplementation("org.testcontainers:junit-jupiter")
    testImplementation("org.testcontainers:postgresql")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<Test> {
    useJUnitPlatform()
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
            org.testcontainers.containers.PostgreSQLContainer("pgvector/pgvector:pg18")
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

