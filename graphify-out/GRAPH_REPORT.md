# Graph Report - juvenile-tiger  (2026-09-19)

## Corpus Check
- 117 files · ~198,170 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 10 file(s) not represented in the graph (top: .css 3, (none) 2, .webmanifest 1)

## Summary
- 977 nodes · 2051 edges · 63 communities (56 shown, 7 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 111 edges (avg confidence: 0.86)
- Token cost: UNKNOWN — semantic extraction ran on host-agent subagents whose per-agent usage was not exposed to the pipeline. The 0/0 figures in graph.json/cost.json are schema placeholders, not a zero-cost measurement.

## Community Hubs (Navigation)
- Observation APIs & Drive Sync
- Photo Upload & Memory Findings
- Photo Pipeline Test Harness
- Operator & Settings Routes
- D1 Schema & Heart ADR
- Build Scripts & Fixtures
- Domain Concepts & Camera Recovery
- OAuth Callback & Crypto
- libjpeg Scalable Decoder (C)
- Node Test Harnesses
- Public & Operator Pages
- Package Manifest
- Tenant Data Access
- Heart Tests & Script Helpers
- Session & Cookie Auth
- PWA Launcher Icons
- Admin Page Types & Helpers
- TypeScript Configuration
- Admin Dashboard Actions
- Deploy, Migrations & Health Contract
- Dev Dependencies
- CSS Build & Verify Scripts
- Class Management Routes
- HEIC Conversion & Capture Time
- Photo Memory Recovery Tests
- Runtime Env & Legacy Purge
- CI & Auto-PR Workflows
- Korean Region Geocoding
- Local Dev Environment Script
- Student Draft Persistence Tests
- ChatGPT Auth Proxy
- Compass Calibration Guide
- NPM Scripts
- JPEG Codec WASM Runtime
- Storage & Consistency Model
- Cloudflare Worker Entry
- EXIF Orientation Fixture
- Rendered HTML Test Harness
- Sheets Contract & Text Normalization
- Student Guidance Tests
- Next.js App Shell
- Deploy Workflow Steps
- Student Capture & Draft Concepts
- Vite Build Config
- Runtime Dependencies
- Open Graph Share Card
- Student Number Range Tests
- ESLint Configuration
- Favicon Mark
- Globe Starter Icon
- Moon Guidance & Compass UI
- CI Install Script
- Apple Touch Icon
- Tenant Label Refresh
- Crop Test Fixture
- Progressive JPEG Fixture
- Window Starter Icon
- PostCSS Configuration
- File Starter Icon
- Photo Codec Build Script
- Verified Build Script
- PWA Install Guidance UI

## God Nodes (most connected - your core abstractions)
1. `HttpError` - 80 edges
2. `errorResponse()` - 50 edges
3. `json()` - 47 edges
4. `getEnv()` - 43 edges
5. `getTeacherById()` - 37 edges
6. `assertSameOrigin()` - 33 edges
7. `getTeacherSession()` - 28 edges
8. `AdminPage()` - 21 edges
9. `getTeacherAccessToken()` - 21 edges
10. `GET()` - 20 edges

## Surprising Connections (you probably didn't know these)
- `학급별 브라우저 쿠키 식별 (최대 1년)` --references--> `voterKeyFor()`  [INFERRED]
  README.md → lib/hearts.ts
- `deleteObservationHearts()` --implements--> `Sheets–D1 비원자적 저장과 복구 한계`  [INFERRED]
  lib/hearts.ts → docs/adr/0001-browser-scoped-observation-hearts.md
- `/api/health 응답 계약 (ok·oauthConfigured)` --references--> `GET()`  [INFERRED]
  README.md → app/api/health/route.ts
- `PUT()` --conceptually_related_to--> `브라우저 기준 하트 중복 방지 (browser-scoped heart dedupe)`  [INFERRED]
  app/api/observations/[id]/heart/route.ts → docs/adr/0001-browser-scoped-observation-hearts.md
- `하트 저장 후 재확인 실패 시 신규 삽입 하트만 보상 삭제` --references--> `PUT()`  [INFERRED]
  README.md → app/api/observations/[id]/heart/route.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **배포 파이프라인 단계 (정적 CSS → vinext 빌드 → D1 마이그레이션 → 게이트 → wrangler deploy)** — github_workflows_deploy_static_css_build_step, github_workflows_deploy_vinext_build_step, github_workflows_deploy_d1_migration_step, github_workflows_deploy_migration_gate_step, github_workflows_deploy_wrangler_deploy_step [EXTRACTED 1.00]
- **저장 구조 (학생 브라우저 → 중앙 Worker API → 교사 Drive/Sheets/중앙 D1)** — readme_student_browser, readme_central_worker_api, readme_teacher_google_drive_photos, readme_teacher_google_sheets_records, readme_central_d1 [EXTRACTED 1.00]
- **하트 반응 흐름 (쿠키 식별·D1 고유 제약·재확인 보상·마이그레이션)** — readme_heart_reaction_store, readme_class_browser_cookie_identity, readme_heart_compensation_on_verification_failure, readme_distributed_consistency_policy, readme_d1_heart_table_migration [EXTRACTED 1.00]
- **마이그레이션 게이트 배포와 /api/health 상태 점검** — readme_health_endpoint_contract, readme_d1_heart_table_migration, readme_automatic_deployment, readme_deploy_bindings [INFERRED 0.85]
- **브라우저 기준 하트 중복 방지 설계** — docs_adr_0001_browser_scoped_observation_hearts_browser_scoped_dedupe, docs_adr_0001_browser_scoped_observation_hearts_browser_voter_identity, docs_adr_0001_browser_scoped_observation_hearts_voter_key_unique_constraint, docs_adr_0001_browser_scoped_observation_hearts_privacy_over_one_per_person [EXTRACTED 1.00]
- **Sheets–D1 하트 일관성 처리 흐름** — docs_adr_0001_browser_scoped_observation_hearts_sheets_d1_storage_split, docs_adr_0001_browser_scoped_observation_hearts_voter_key_unique_constraint, docs_adr_0001_browser_scoped_observation_hearts_cross_store_recovery_limit, docs_adr_0001_browser_scoped_observation_hearts_google_sheets, docs_adr_0001_browser_scoped_observation_hearts_cloudflare_d1 [EXTRACTED 1.00]
- **ADR 0001 결과 절의 수용된 한계** — docs_adr_0001_browser_scoped_observation_hearts_duplicate_participation_surface, docs_adr_0001_browser_scoped_observation_hearts_irreversible_identity_attribution, docs_adr_0001_browser_scoped_observation_hearts_cross_store_recovery_limit [EXTRACTED 1.00]
- **External Camera Memory Recovery Flow** — docs_superpowers_specs_2026_09_09_external_camera_memory_recovery_design_synchronous_precamera_preparation, docs_superpowers_specs_2026_09_09_external_camera_memory_recovery_design_camera_pending_marker, docs_superpowers_specs_2026_09_09_external_camera_memory_recovery_design_return_and_cancellation_handling, docs_superpowers_specs_2026_09_09_external_camera_memory_recovery_design_document_recreation_recovery, docs_superpowers_plans_2026_09_09_external_camera_memory_recovery_precamera_memory_release_task, docs_superpowers_plans_2026_09_09_external_camera_memory_recovery_recreation_recovery_task [EXTRACTED 1.00]
- **High-resolution JPEG Safe Decoding Pipeline** — docs_superpowers_specs_2026_09_11_safe_high_resolution_jpeg_design_header_based_format_detection, docs_superpowers_specs_2026_09_11_safe_high_resolution_jpeg_design_worker_reduced_idct_decoding, docs_superpowers_specs_2026_09_11_safe_high_resolution_jpeg_design_no_native_fallback_for_oversized, docs_superpowers_specs_2026_09_11_safe_high_resolution_jpeg_design_output_normalization, docs_superpowers_specs_2026_09_11_safe_high_resolution_jpeg_design_deterministic_resource_release, public_photo_pipeline, public_photo_worker, docs_superpowers_specs_2026_09_11_safe_high_resolution_jpeg_design_moon_jpeg_codec_component, public_index_photo_pipeline_integration [EXTRACTED 1.00]
- **Night Sky Icon Composition** — public_apple_touch_icon_night_sky_emblem, public_apple_touch_icon_crescent_moon_motif, public_apple_touch_icon_star_dots [EXTRACTED 1.00]
- **Four-Step Smartphone Compass Calibration Flow** — public_compass_calibration_guide_step1_avoid_magnets, public_compass_calibration_guide_step2_figure_eight, public_compass_calibration_guide_step3_flat_screen_up, public_compass_calibration_guide_step4_turn_to_bearing, public_compass_calibration_guide_compass_calibration [EXTRACTED 1.00]
- **From Calibrated Compass to Located Moon** — public_compass_calibration_guide_compass_calibration, public_compass_calibration_guide_bearing_reading, public_compass_calibration_guide_bearing_vs_altitude, public_compass_calibration_guide_moon_direction_finding [EXTRACTED 1.00]
- **Guide Narrative Cast (Child Demonstrator and Owl Narrator)** — public_compass_calibration_guide_child_character, public_compass_calibration_guide_owl_mascot, public_compass_calibration_guide_poster [EXTRACTED 1.00]
- **Four-Tile Blue Mosaic Mark Composition** — public_favicon_quadrant_tiles, public_favicon_rounded_corner_geometry, public_favicon_blue_palette [EXTRACTED 1.00]
- **Globe Icon Composition** — public_globe_icon, public_globe_circular_globe_form, public_globe_graticule_grid, public_globe_flat_monochrome_rendering [EXTRACTED 1.00]
- **Night-sky share card composition (sky + moon + headline)** — public_og_share_card, public_og_heading_gongju_moon_observation_expedition, public_og_full_moon_illustration, public_og_night_sky_starfield [INFERRED 0.85]
- **Night-Sky Iconography Composite** — public_pwa_icon_192_circular_night_sky_badge, public_pwa_icon_192_crescent_moon_mark, public_pwa_icon_192_star_field, public_pwa_icon_192_night_sky_palette [EXTRACTED 1.00]
- **Night-Sky Emblem Composition** — public_pwa_icon_512_crescent_moon_mark, public_pwa_icon_512_star_dots, public_pwa_icon_512_night_sky_medallion, public_pwa_icon_512_dark_rounded_tile [EXTRACTED 1.00]
- **Night-Sky Emblem Composition (badge + moon + stars)** — public_pwa_icon_circular_night_sky_badge, public_pwa_icon_crescent_moon_mark, public_pwa_icon_star_field [INFERRED 0.85]
- **PWA Icon Raster Family (SVG master rendered to 192 and 512 PNG)** — public_pwa_icon_vector_master, public_pwa_icon_512_app_icon, public_pwa_icon_192_pwa_launcher_icon [INFERRED 0.85]
- **Synthetic Crop Fixture: Quadrant Landmark Pattern, Odd-Dimension Baseline Encoding, Crop-Test Role** — tests_fixtures_crop_4015x4594_crop_fixture_image, tests_fixtures_crop_4015x4594_quadrant_color_pattern, tests_fixtures_crop_4015x4594_odd_dimension_baseline_jpeg, tests_fixtures_crop_4015x4594_crop_pipeline_fixture_role [EXTRACTED 1.00]
- **EXIF Orientation-6 Round-Trip Fixture Group** — tests_fixtures_oriented_320x480_o6_fixture, tests_fixtures_oriented_320x480_o6_exif_orientation_tag_6, tests_fixtures_oriented_320x480_o6_stored_portrait_raster_320x480, tests_fixtures_oriented_320x480_o6_displayed_landscape_geometry_480x320, tests_fixtures_oriented_320x480_o6_decode_orientation_check [INFERRED 0.85]
- **original-5222x6024.jpg Fixture Lifecycle (Generate, Load, Assert, Upload-check)** — scripts_make_fixtures_save_pattern, tests_fixtures_original_5222x6024_baseline_jpeg_fixture, tests_codec_test_requirefixture, scripts_verify_mobile_upload [INFERRED 0.85]
- **31 MP Baseline JPEG Decode Verification (content, size, encoding)** — tests_fixtures_original_5222x6024_quadrant_color_pattern, tests_fixtures_original_5222x6024_large_dimension_stress, tests_fixtures_original_5222x6024_chroma_subsampling_420 [INFERRED 0.85]
- **Progressive Fixture Composition (scene, scale, encoding)** — tests_fixtures_progressive_5222x6024_progressive_jpeg_fixture, tests_fixtures_progressive_5222x6024_color_block_pattern, tests_fixtures_progressive_5222x6024_large_format_canvas, tests_fixtures_progressive_5222x6024_jpeg_encoding_profile [EXTRACTED 1.00]
- **Graphify Code-Only CI Pipeline (pinned CLI, extraction, artifact, PR conflict gate)** — github_workflows_ci_pinned_graphifyy_version, github_workflows_ci_code_only_graphify, github_workflows_ci_graphify_code_only_artifact, github_workflows_ci_community_conflict_gate [EXTRACTED 1.00]
- **Automated PR Lifecycle (auto-created PR, CI run, community conflict gate)** — github_workflows_auto_pr_automatic_pr_creation, github_workflows_ci_ci_workflow, github_workflows_ci_community_conflict_gate [INFERRED 0.75]
- **Automatic PR Creation Flow (branch triggers, existence check, base resolution, body, create)** — github_workflows_auto_pr_branch_trigger_patterns, github_workflows_auto_pr_pr_existence_check, github_workflows_auto_pr_base_branch_resolution, github_workflows_auto_pr_pr_body_generation, github_workflows_auto_pr_automatic_pr_creation [EXTRACTED 1.00]

## Communities (63 total, 7 thin omitted)

### Community 0 - "Observation APIs & Drive Sync"
Cohesion: 0.06
Nodes (99): requireTeacher(), ClassInvite, GET(), POST(), requireTeacher(), responseFor(), contextFor(), DELETE() (+91 more)

### Community 1 - "Photo Upload & Memory Findings"
Cohesion: 0.06
Nodes (59): Duplicate Reservation Release Fix, Exactly-once Limitation Disclosure, Best-effort Gallery Preview, Unified Resolution Header Probe, LMKD Process Reclaim Root Cause, 16 Pre-existing tsc Errors, Previous Compressed Blob Retention, Production Byte-Identity Verification (SHA-256) (+51 more)

### Community 2 - "Photo Pipeline Test Harness"
Cohesion: 0.05
Nodes (4): ErrorWorker, pipelinePath, SilentWorker, workerPath

### Community 3 - "Operator & Settings Routes"
Cohesion: 0.15
Nodes (31): GET(), DELETE(), GET(), POST(), GET(), PATCH(), requireTeacher(), DELETE() (+23 more)

### Community 4 - "D1 Schema & Heart ADR"
Cohesion: 0.07
Nodes (31): getDb(), imageTickets, legacyObservations, oauthConfig, observationHearts, observations, submissionEvents, submissionReceipts (+23 more)

### Community 5 - "Build Scripts & Fixtures"
Cohesion: 0.09
Nodes (28): argparse, pathlib, pil, ref_node_child_process, ref_node_os, save_pattern(), assert, coefficientGuardFixture() (+20 more)

### Community 6 - "Domain Concepts & Camera Recovery"
Cohesion: 0.11
Nodes (28): 브라우저 단위 중복 방지 (Browser-Scoped Duplicate Prevention), 학급 공개 범위 (Class-Shared Visibility), 하트 (Heart), 달 관찰 수업 (Moon Observation Class), 관찰 기록 (Observation Record), 교사 피드백 (Teacher Feedback), Delivery Limitation Reporting, External Camera Memory and Recovery Implementation Plan (+20 more)

### Community 7 - "OAuth Callback & Crypto"
Cohesion: 0.16
Nodes (25): GET(), redirectResponse(), POST(), clearOAuthStateCookie(), getOAuthState(), decoder, decryptString(), encoder (+17 more)

### Community 8 - "libjpeg Scalable Decoder (C)"
Cohesion: 0.10
Nodes (15): choose_reduced_scale(), coefficient_bytes_exceed_limit(), moon_decode(), moon_error_exit(), moon_quiet_message(), moon_release(), j_common_ptr, jerror (+7 more)

### Community 9 - "Node Test Harnesses"
Cohesion: 0.15
Nodes (12): ref_node_assert_strict, ref_node_fs, ref_node_test, ref_node_vm, typescript, harness(), heicBytes(), HttpError (+4 more)

### Community 10 - "Public & Operator Pages"
Cohesion: 0.10
Nodes (8): JoinPage(), GoogleConfig, LegacySummary, OperatorPage(), 학생용 QR 입장, 로그인 없는 학생 제출, ref_next_link, react

### Community 11 - "Package Manifest"
Cohesion: 0.09
Nodes (20): displayName, engines, node, name, private, type, version, @cloudflare/vite-plugin (+12 more)

### Community 12 - "Tenant Data Access"
Cohesion: 0.12
Nodes (21): DEFAULT_OBSERVATION_LAT, DEFAULT_OBSERVATION_LON, DEFAULT_REGION_LABEL, DEFAULT_REGION_SHORT_LABEL, findAccount(), findTeacher(), hasAccountRegionColumns(), mapAccount() (+13 more)

### Community 13 - "Heart Tests & Script Helpers"
Cohesion: 0.13
Nodes (15): ref_node_sqlite, addClass(), COLUMNS, cookieToken(), d1(), establishedCookie(), heartCookie(), heartRequest() (+7 more)

### Community 14 - "Session & Cookie Auth"
Cohesion: 0.21
Nodes (18): DELETE(), GET(), POST(), clearAdminCookie, clearStudentCookie(), cookie(), createAdminCookie(), createOperatorCookie() (+10 more)

### Community 15 - "PWA Launcher Icons"
Cohesion: 0.16
Nodes (20): Circular Night-Sky Badge (navy disc with slate-blue rim on rounded-square ground), Golden Crescent Moon Mark, Maskable Centered Composition (small centered mark, generous padding, no text), Night-Sky Palette (golden yellow on near-black navy with slate-blue accents), PWA Launcher Icon 192x192 (Moon Observation Expedition install icon), Four-Dot Star Field (pale blue and off-white stars), PWA App Icon (512x512 PNG), Crescent Moon Mark (golden-yellow, opening facing upper-right) (+12 more)

### Community 16 - "Admin Page Types & Helpers"
Cohesion: 0.11
Nodes (15): clampFeedback(), ClassInfo, formatObservedAt(), formatSubmittedAt(), GeocodeCandidate, HeartControl(), InviteInfo, Observation (+7 more)

### Community 17 - "TypeScript Configuration"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 18 - "Admin Dashboard Actions"
Cohesion: 0.12
Nodes (4): AdminPage(), saveRegionSettings(), compactRegionName(), deriveStudentRegionLabel()

### Community 19 - "Deploy, Migrations & Health Contract"
Cohesion: 0.17
Nodes (17): CLOUDFLARE_ACCOUNT_ID workflow env, Apply D1 migrations step, DRIVE_FILE_SCOPE, TeacherDriveResources, 자동 배포 (main 푸시 → GitHub Actions), drizzle/0004_observation_hearts.sql 마이그레이션, 배포 환경 바인딩·설정, 개발 명령 (+9 more)

### Community 20 - "Dev Dependencies"
Cohesion: 0.12
Nodes (17): devDependencies, @cloudflare/vite-plugin, drizzle-kit, eslint, eslint-config-next, react-server-dom-webpack, tailwindcss, @tailwindcss/postcss (+9 more)

### Community 21 - "CSS Build & Verify Scripts"
Cohesion: 0.13
Nodes (14): ref_node_fs_promises, ref_node_http, ref_node_path, ref_node_url, ref_postcss, @tailwindcss/postcss, outputPath, projectRoot (+6 more)

### Community 22 - "Class Management Routes"
Cohesion: 0.30
Nodes (15): classLinks(), DELETE(), GET(), normalizeClassLabel(), PATCH(), POST(), requireTeacher(), responseFor() (+7 more)

### Community 23 - "HEIC Conversion & Capture Time"
Cohesion: 0.24
Nodes (14): POST(), RESPONSE_HEADERS, transformHeic(), asciiValue(), captureTimeFromTiff(), directory(), entry(), findTiffCandidate() (+6 more)

### Community 24 - "Photo Memory Recovery Tests"
Cohesion: 0.13
Nodes (5): DangerousImage, html, LegacyImage, pipelineSource, png()

### Community 25 - "Runtime Env & Legacy Purge"
Cohesion: 0.24
Nodes (8): GET(), getLegacyStudentDataSummary(), LegacyRow, legacyTableExists(), purgeLegacyStudentDataBatch(), AppEnv, getEnv(), rotateInviteToken()

### Community 26 - "CI & Auto-PR Workflows"
Cohesion: 0.21
Nodes (14): Auto PR Workflow, Automatic PR Creation, Base Branch Resolution (main with master fallback), Auto PR Branch Triggers, PR Body Generation via printf, PR Existence Check via gh pr view, CI Workflow, Code-only Graphify (AST) Pass (+6 more)

### Community 27 - "Korean Region Geocoding"
Cohesion: 0.25
Nodes (12): KOREAN_REGION_CENTERS, KoreanRegionCenter, KoreanRegionLevel, compact(), regionLabel(), regionShortLabel(), regionTokens(), SAFE_SHORT_PREFIX_SIDOS (+4 more)

### Community 28 - "Local Dev Environment Script"
Cohesion: 0.14
Nodes (13): HOME, MINIFLARE_REGISTRY_PATH, npm_config_audit, npm_config_cache, npm_config_fund, npm_config_update_notifier, sites-env.sh script, SITES_ENV_READY (+5 more)

### Community 29 - "Student Draft Persistence Tests"
Cohesion: 0.15
Nodes (4): fields, html, storage(), html

### Community 30 - "ChatGPT Auth Proxy"
Cohesion: 0.29
Nodes (10): chatGPTSignInPath(), chatGPTSignOutPath(), ChatGPTUser, getChatGPTUser(), isReservedAuthPath(), requireChatGPTUser(), safeDecodeURIComponent(), safeRelativeReturnPath() (+2 more)

### Community 31 - "Compass Calibration Guide"
Cohesion: 0.35
Nodes (11): Drawn Compass Display Reading 135 Degrees (Southeast), Bearing vs. Altitude - Compass Gives Horizontal Direction Only, Child Guide Character Demonstrating Each Step, Smartphone Compass Calibration, Finding the Moon's Direction in the Night Sky, Owl Mascot Delivering the Closing Accuracy Message, Compass Calibration Guide Poster (Korean instructional illustration), Step 1 - Move Magnets and Metal Objects Away (+3 more)

### Community 32 - "NPM Scripts"
Cohesion: 0.20
Nodes (10): scripts, build, build:static, db:generate, deploy, dev, install:ci, lint (+2 more)

### Community 33 - "JPEG Codec WASM Runtime"
Cohesion: 0.24
Nodes (4): EmscriptenEH, EmscriptenSjLj, getMemoryBuffer(), updateMemoryViews()

### Community 34 - "Storage & Consistency Model"
Cohesion: 0.27
Nodes (10): 중앙 D1 / 교사 연결정보·임시 식별표·브라우저 단위 하트, 중앙 Worker API, 학급별 브라우저 쿠키 식별 (최대 1년), 중앙 D1 잔존 데이터 목록, 분산 일관성 정책, 이미지 전달표 재사용 최적화, 하트 저장 후 재확인 실패 시 신규 삽입 하트만 보상 삭제, 하트 저장소 (D1 (class_id, observation_id, voter_key) 고유 제약) (+2 more)

### Community 35 - "Cloudflare Worker Entry"
Cohesion: 0.20
Nodes (6): ref_vinext_server_app_router_entry, ref_vinext_server_image_optimization, Env, ExecutionContext, studentHtml(), worker

### Community 36 - "EXIF Orientation Fixture"
Cohesion: 0.24
Nodes (10): Blue Background Field (RGB 40,70,100), Decode-Pipeline Orientation Swap Check, Displayed Landscape Geometry 480x320, EXIF Orientation Tag 6 (Rotate 90 Degrees Clockwise on Display), Oriented JPEG Test Fixture (EXIF Orientation 6), Green Quadrant Block (RGB 30,160,40), Large-Header JPEG Parser Probe, Red Quadrant Block (RGB 180,40,30) (+2 more)

### Community 38 - "Sheets Contract & Text Normalization"
Cohesion: 0.25
Nodes (9): DriveObservation, normalizeText(), 연결 해제 정책, 한 계정 다중 반 지원, Sheets 관찰 기록 열 구조, 제출 텍스트 정규화, 교사 Google Drive 연결, 달 관찰 탐험대 Drive 구조 (+1 more)

### Community 39 - "Student Guidance Tests"
Cohesion: 0.28
Nodes (4): classList(), connectedCompassPage(), html, loadStudentPage()

### Community 40 - "Next.js App Shell"
Cohesion: 0.29
Nodes (4): app_globals, metadata, nextConfig, next

### Community 41 - "Deploy Workflow Steps"
Cohesion: 0.33
Nodes (7): deploy job (ubuntu-latest, timeout 20), deploy-cloudflare-production concurrency group, Require successful D1 migrations step, Build static student CSS step, vinext Worker build step, Deploy Cloudflare Worker workflow, wrangler deploy step

### Community 42 - "Student Capture & Draft Concepts"
Cohesion: 0.47
Nodes (6): photoTimeGapSummary(), 서명된 학급 복원 토큰 (6시간), 관찰 초안 임시 저장 (sessionStorage), 촬영 시각 검토 (30분 규칙), 브라우저 사진 처리 파이프라인, 학생 브라우저

### Community 43 - "Vite Build Config"
Cohesion: 0.33
Nodes (4): build_sites_vite_plugin, build_sites_vite_plugin_sites, vinext, vite

### Community 44 - "Runtime Dependencies"
Cohesion: 0.33
Nodes (6): dependencies, drizzle-orm, next, qrcode.react, react, react-dom

### Community 45 - "Open Graph Share Card"
Cohesion: 0.60
Nodes (6): Realistic golden full moon with crater mottling and diffuse amber halo, upper right, Gongju Moon Observation Expedition app (달 관찰 탐험대) - Next.js PWA on Cloudflare Workers used as og:image target, Headline text "공주 달 관찰 탐험대" (Gongju Moon Observation Expedition) in pale cream block lettering, Deep navy night sky background with scattered white/blue stars and cross-ray sparkles, Open Graph Share Card - Moon Observation Expedition (1200x630, night sky with full moon), Truncated IDAT stream - only top 267 of 630 rows decode; committed og.png is corrupt, lower ~58% of the card unrecoverable

### Community 46 - "Student Number Range Tests"
Cohesion: 0.40
Nodes (4): currentObservedAt(), exports, formFor(), HttpError

### Community 47 - "ESLint Configuration"
Cohesion: 0.40
Nodes (4): eslintConfig, ref_eslint_config, ref_eslint_config_next_core_web_vitals, ref_eslint_config_next_typescript

### Community 48 - "Favicon Mark"
Cohesion: 0.40
Nodes (5): Three-Tone Blue Palette (#0C79D8 Deep, #2E9EFF Mid, #68C4FF Light), Browser Tab / Bookmark Icon Role for the Web App, Favicon Mark (public/favicon.svg), Four Rounded-Square Quadrant Tiles (2x2 Mosaic), Rounded-Corner Squircle Geometry on 24x24 viewBox

### Community 49 - "Globe Starter Icon"
Cohesion: 0.60
Nodes (5): Circular Globe Form, Flat Monochrome Rendering, Latitude/Longitude Graticule, globe.svg - Next.js starter globe icon (16x16 flat monochrome, currently unreferenced), Web / Global Connectivity Symbolism

### Community 50 - "Moon Guidance & Compass UI"
Cohesion: 0.40
Nodes (5): 달력 월 이동 (changeMonth/renderCalendar), 나침반 보정 (setCalibrating/pauseCompass), 심야 제출 확인 대화상자, MoonEngine (달 위치·위상 계산), 오늘의 달 안내 (decideObservationGuidance)

### Community 51 - "CI Install Script"
Cohesion: 0.40
Nodes (4): NPM_CONFIG_FETCH_RETRIES, NPM_CONFIG_FETCH_TIMEOUT, NPM_CONFIG_MAXSOCKETS, install-ci.sh script

### Community 52 - "Apple Touch Icon"
Cohesion: 0.67
Nodes (4): Apple Touch Icon (180x180 PWA Home Screen Icon), Golden Crescent Moon Motif, Night Sky Circular Emblem, Four Circular Star Dots

### Community 53 - "Tenant Label Refresh"
Cohesion: 0.83
Nodes (3): normalizedLabel(), refreshLabel(), replaceLabels()

### Community 54 - "Crop Test Fixture"
Cohesion: 0.83
Nodes (4): crop-4015x4594.jpg — Synthetic Crop-Test JPEG Fixture (4015x4594, 17.5 MP), Image-Pipeline Crop Fixture Role: Non-MCU-Aligned 4015px Width Exercises Edge Crop, Scaled IDCT and 6 MiB Re-Encode Paths, Odd-Dimension Baseline (Non-Progressive) JPEG: 4015x4594, No EXIF Orientation, Quadrant Landmark Pattern: Red Top-Left Quarter, Green Bottom-Right Quarter, Dark Navy Background

### Community 55 - "Progressive JPEG Fixture"
Cohesion: 0.67
Nodes (4): 2x2 Flat Colour-Block Test Pattern, JPEG Encoding Profile (quality 93, 4:2:0, progressive), 31 MP Large-Format Canvas (5222x6024), Progressive JPEG Fixture (5222x6024)

### Community 56 - "Window Starter Icon"
Cohesion: 1.00
Nodes (3): Three Window Control Dots (Uniform Gray Circle Cluster), Window Frame Chrome (Rounded Bottom-Corner Frame, Title Bar Band), Window Icon (16x16 Window Chrome Glyph)

## Ambiguous Edges - Review These
- `Night-Sky Circular Medallion (deep navy disk, slate-blue rim)` → `Maskable-Icon Centered Safe Zone (~66% inset emblem)`  [AMBIGUOUS]
  public/pwa-icon-512.png · relation: conceptually_related_to

## Knowledge Gaps
- **219 isolated node(s):** `Observation`, `ClassInfo`, `InviteInfo`, `GeocodeCandidate`, `PageResult` (+214 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 390 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Night-Sky Circular Medallion (deep navy disk, slate-blue rim)` and `Maskable-Icon Centered Safe Zone (~66% inset emblem)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `cookie()` connect `Session & Cookie Auth` to `Observation APIs & Drive Sync`, `Operator & Settings Routes`, `OAuth Callback & Crypto`, `Heart Tests & Script Helpers`, `Class Management Routes`?**
  _High betweenness centrality (0.184) - this node is a cross-community bridge._
- **Why does `typescript` connect `Node Test Harnesses` to `Package Manifest`, `Heart Tests & Script Helpers`, `Student Number Range Tests`?**
  _High betweenness centrality (0.106) - this node is a cross-community bridge._
- **Why does `HttpError` connect `Observation APIs & Drive Sync` to `Operator & Settings Routes`, `Sheets Contract & Text Normalization`, `OAuth Callback & Crypto`, `Tenant Data Access`, `Session & Cookie Auth`, `Class Management Routes`, `HEIC Conversion & Capture Time`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **What connects `Observation`, `ClassInfo`, `InviteInfo` to the rest of the system?**
  _219 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Observation APIs & Drive Sync` be split into smaller, more focused modules?**
  _Cohesion score 0.0555019305019305 - nodes in this community are weakly interconnected._
- **Should `Photo Upload & Memory Findings` be split into smaller, more focused modules?**
  _Cohesion score 0.060153776571687016 - nodes in this community are weakly interconnected._