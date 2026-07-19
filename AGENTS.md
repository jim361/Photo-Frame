# PhotoFrame — 에이전트 작업 가이드

사진에 프레임과 촬영 정보를 얹어 인스타그램 업로드용 이미지를 만드는 **로컬 웹 도구**.
단일 HTML(`index.html`, 바닐라 JS + Canvas 2D, 의존성 0)이 소스 전부이자 기능 명세의 원본이다.

- 저장소: https://github.com/jim361/Photo-Frame (main)
- 배포: https://jim361.github.io/Photo-Frame/ — main에 푸시하면 GitHub Pages Actions가 1~2분 내 자동 배포
- `legacy/filmframe.html`은 v3 원본 보존용 — **수정 금지**
- `docs/HANDOFF.md`는 프로젝트 초기(v3 시절) 지시서 — 역사 기록용이며 현재 상태와 다름. 현재 상태는 이 문서와 `CHANGELOG.md`, `docs/features/*.md`가 기준

## 절대 규칙

1. **사진 데이터를 외부로 보내는 코드는 어떤 이유로도 금지** (analytics 포함). 외부 리소스 요청 0건 — 기본은 시스템 글꼴, 추가 글꼴은 PC 권한 또는 사용자가 직접 고른 로컬 파일만 사용
2. **편집 기능(색보정/크롭)은 스코프 밖** — 이 도구는 프레임만 얹는다
3. 단일 HTML 유지 — 내려받아 더블클릭으로 여는 사용 방식을 지킨다. 새 의존성 추가 금지
4. **미리보기 = 내보내기** — 같은 `render()` 경로. 경계 오버레이만 미리보기 전용
5. UI 언어는 한국어

## 작업 규약

- 커밋: Conventional Commits — **타입은 영어, 본문은 한국어**. 변경 이유·검증 내용을 본문에 남긴다
- 기능 변경 시 해당 `docs/features/*.md`의 "현재 동작"을 함께 갱신하고, `CHANGELOG.md`의 Unreleased에 한 줄 추가 — 문서와 코드가 어긋난 채 두지 않는다
- 로컬 미리보기: `python -m http.server 8321`. **주의: 이 서버가 index.html을 캐시하므로 검증 시 `?v=N` 쿼리로 캐시를 우회할 것**
- 배포 검증: 푸시 → GitHub Actions run 완료 확인 → 라이브 페이지에서 변경 마커 문자열 확인 (캐시 우회 쿼리 사용)
- 불명확한 설계 판단은 임의로 확정하지 말고 선택지를 제시하고 물어볼 것
- **검증 교훈: 렌더 경로만 확인하면 부족하다** — 신선 로드(localStorage 비운 상태)에서 하단 init 블록이 끝까지 실행되는지, 콘솔 오류 0건인지 반드시 확인. 최상위 스크립트 중간에 예외가 나면 이후 초기화(프리셋/레이아웃/로고 UI)가 통째로 죽는다

## 아키텍처 핵심 (index.html 내부)

모든 수치는 **사진 폭 W의 비율**로 저장 — 해상도 무관 동일 배치.

- `render(src, opts, info)` — 원본 해상도로 합성 후 축소. `info.collect`가 참이면 요소 박스를 `info.boxes`로 수집(미리보기 오버레이용). 스타일: `film`(필름 스트립, 세로 사진은 좌우 퍼포레이션) / `instax`(세로=하단 여백 카드, 가로=우측 여백) / `bottom`/`top`(여백 띠)
- 요소 모델: `ELEM_KEYS = ['body','lens','film','set','date','cap','logo']` — 구분자 없이 `rowLayout()`이 간격 배치. 요소별 드래그 오프셋은 `OFF_KEYS`(각 키의 DX/DY, W 비율)
- 스타일·방향별 프로파일: `adv[style].port` / `adv[style].land` — 프레임별 레이아웃·배율·오프셋을 분리하고 세로/가로 사진에 따라 자동 선택(`withProfile`)
- 장별 EXIF 분리: `readExif()`(자체 JPEG APP1/TIFF 파서), `shot.exif`(자동) / `shot.own`(장별 수정) / `gInfo`(전역), 렌더는 `withShot()` 병합
- 로컬 글꼴: 기본 시스템 스택 / `queryLocalFonts()` PC 글꼴(데스크톱 Chromium, 이름만 저장) / FontFace 파일 글꼴(TTF·OTF·WOFF·WOFF2, 선택된 파일만 프로젝트 JSON에 dataURL 포함)
- 경계 오버레이·드래그: `state._pv`에 렌더 캐시 → `paintOverlay()`. 요소 박스 드래그(스냅 가이드, 더블클릭 리셋), 프레임 크기 핸들(하단 공간=경계선, 인스탁스 테두리 여백=사진 우상단 모서리 그립 — 왼쪽·아래로 끌면 커짐), 호버 강조 + 방향 커서. `layoutUndo`가 마지막 요소 이동·크기·수치·프리셋·초기화 직전 스타일 프로파일을 1단계 보관한다. 히트 우선순위: 그립 → 선 → 박스 → 팬. 드래그 중에는 1400px 축소본으로 렌더(fit 모드), 좌표는 renderW로 정규화
- localStorage: `frame.settings`(전역 설정) / `frame.gear`(장비 프리셋) / `frame.logos` / `frame.layouts`(배치 프리셋) / `frame.ui`(패널 폭·배율·경계 표시 여부 — **병합 방식으로 써서 서로 덮어쓰지 않게 유지**) / `frame.panels`
- 내보내기: 인스타 비율 패딩(`padToRatio`), File System Access API 폴더 저장(Chromium) + 다운로드 폴백, 제목 순번 명명

## 현재 상태 (2026-07-19)

v1.0.0 태그까지 릴리즈됨 + 이후 Unreleased 변경분은 `CHANGELOG.md` 참조.
최근 완료: 요소 개별 배치(구분자 제거·드래그), 1단계 레이아웃 돌아가기, 한/영 글꼴 분리와 로컬 PC·파일 글꼴, 프레임 크기 핸들(모서리 그립·호버 강조·경계 기본 표시), 스타일·방향별 레이아웃 프리셋, 가로 인스탁스 회전 요소 드래그, 넘침 빨간 경고, 사진 원본 없는 프로젝트 JSON 저장·복원, 첫 화면 안내문 줄바꿈 개선.

**남은 백로그** (우선순위 미정 — 착수 전 사용자와 상의):
- README 데모 GIF/스크린샷
- 핀치 줌(모바일), 프리셋 JSON 내보내기/가져오기, 장소 필드
- 멀티 뷰 라이트테이블(보류 — 사용자가 먼저 언급할 때만)
- 2단계 Vite+TS 마이그레이션(착수 전 사용자 확인 필수)
