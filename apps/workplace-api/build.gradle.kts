import org.gradle.api.services.BuildService
import org.gradle.api.services.BuildServiceParameters
import java.io.File
import java.nio.channels.FileChannel
import java.nio.channels.FileLock
import java.nio.file.StandardOpenOption

plugins {
    java
    id("org.springframework.boot") version "3.4.1"
    id("io.spring.dependency-management") version "1.1.7"
    id("nu.studer.jooq") version "9.0"
    id("com.diffplug.spotless") version "6.25.0"
    jacoco
}

/**
 * 공유 통합 테스트 DB(localhost:5435) 직렬화 락.
 *
 * 모든 통합 테스트는 단일 `workplace_test`(컨테이너 1개)를 공유한다. 두 개의 `test` 실행이 동시에 붙으면
 * 서로의 시드/정리가 교차 커밋되어 RLS 가시성이 assertion 중에 뒤집히거나(비결정 실패), 고정-슬러그 fixture
 * 유니크/FK 충돌, `too many clients` 가 난다(#512 후속). 이 문제는 자원(DB) 소유의 성질이라 훅이 아니라
 * **테스트 실행 지점**에서 막아야 훅·수동 `./gradlew test`·IDE 를 모두 덮는다.
 *
 * 구현: 빌드 서비스가 인스턴스화될 때 고정 경로(/tmp)의 파일에 **blocking OS FileLock** 을 잡는다. FileLock 은
 * OS 레벨이라 워크트리·gradle 데몬을 가로질러 배타적이며, 다른 프로세스가 잡고 있으면 대기(큐잉)한다. 프로세스가
 * 죽으면 OS 가 자동 해제하므로 stale 락이 남지 않는다. 빌드 종료 시 close()로 해제한다.
 */
abstract class SharedTestDbLock : BuildService<BuildServiceParameters.None>, AutoCloseable {
    private val channel: FileChannel =
        FileChannel.open(
            File("/tmp/smart-workplace-test-db.lock").toPath(),
            StandardOpenOption.CREATE,
            StandardOpenOption.WRITE,
        )
    private val lock: FileLock

    init {
        println("[test-db-lock] 공유 통합 테스트 DB(5435) 락 대기/획득…")
        // blocking 배타 락 — 다른 gradle 프로세스가 보유 중이면 여기서 대기한다.
        lock = channel.lock()
        println("[test-db-lock] 락 획득 — 통합 테스트 시작")
    }

    override fun close() {
        try {
            lock.release()
        } finally {
            channel.close()
        }
    }
}

val testDbLock =
    gradle.sharedServices.registerIfAbsent("smartWorkplaceTestDbLock", SharedTestDbLock::class.java) {
        // 한 빌드 안에서도 동시 사용 1개로 제한(프로세스 간 배타는 FileLock 이 담당).
        maxParallelUsages.set(1)
    }

// JaCoCo — 로컬 리포트 전용. 0.8.13: Java 25(class major version 69) 지원
jacoco {
    toolVersion = "0.8.13"
}

group = "com.workplace"
version = "0.0.1-SNAPSHOT"

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
    jooqGenerator("org.postgresql:postgresql")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.security:spring-security-test")
    // 메일 연결 테스트용 임베디드 IMAP/SMTP 서버
    testImplementation("com.icegreen:greenmail-junit5:2.1.0")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<Test> {
    // 공유 test DB(5435) 직렬화 — 훅/수동/IDE 어느 경로로 와도 실제 테스트 실행 전 배타 락을 잡는다.
    // 설정 캐시 호환: 스크립트 top-level 프로퍼티를 doFirst 에서 직접 참조하면 스크립트 객체가 캡처되어
    // 직렬화가 깨진다. 로컬 val 로 Provider 만 캡처한다.
    val lockService = testDbLock
    usesService(lockService)
    doFirst { lockService.get() }
    useJUnitPlatform()
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

// jOOQ codegen — workplace 로컬 개발 DB에서 public 스키마 읽어 타입 안전 SQL 생성
// 결과물: src/main/generated/com/workplace/jooq/
// compileJava 가 자동으로 codegen 을 트리거하지 않도록 분리 (DB 없이 빌드 가능).
// 스키마 변경 후 명시적으로 `./gradlew generateJooq` 실행.
jooq {
    configurations {
        create("main") {
            generateSchemaSourceOnCompilation.set(false)
            jooqConfiguration.apply {
                jdbc.apply {
                    driver = "org.postgresql.Driver"
                    url = "jdbc:postgresql://localhost:5434/workplace"
                    user = "app"
                    password = "app"
                }
                generator.apply {
                    name = "org.jooq.codegen.DefaultGenerator"
                    database.apply {
                        name = "org.jooq.meta.postgres.PostgresDatabase"
                        inputSchema = "public"
                        // Flyway 내부 테이블은 도메인 코드에서 직접 다룰 일 없음
                        excludes = "flyway_schema_history"
                    }
                    target.apply {
                        packageName = "com.workplace.jooq"
                        directory = "src/main/generated"
                    }
                }
            }
        }
    }
}

