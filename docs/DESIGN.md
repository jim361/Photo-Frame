# PhotoFrame — Structural Modernism 디자인 시스템

## 1. 디자인 정체성

PhotoFrame의 UI는 **Structural Modernism**을 따른다. 따뜻한 미색 canvas 위에 흰색 작업 surface를 놓고, 카드나 그림자 대신 그리드·정렬·노출된 구분선으로 구조를 보여준다. 부르탈리즘의 큰 면과 굵은 선은 빈 상태, 선택 상태, 주요 동작처럼 화면에서 가장 중요한 한 곳에만 쓴다.

- 기본 화면은 화이트 테마다. 개인 설정의 화면 테마에서 블랙으로 바꿀 수 있으며, 무채색 배경·본문·구분선만 바꾸고 코발트 및 상태 색은 유지한다.
- cobalt는 주요 동작, focus, 선택, 진행 상태에만 쓴다. 장식용 강조색으로 반복하지 않는다.
- 큰 panel은 직각, 버튼은 거의 직각, 입력은 작은 반경만 사용한다.
- gradient, glass, 장식용 blur·shadow·illustration은 사용하지 않는다.
- 외부 글꼴이나 UI 리소스를 요청하지 않는다. 시스템 글꼴만 사용한다.
- PhotoFrame의 핵심 정보는 합성 미리보기다. 별도의 거대한 장식용 headline을 추가하지 않는다.

## 2. UI 토큰

### 색상

| CSS 변수 | 값 | 역할 |
|---|---|---|
| `--canvas` | `#f2f2ee` | 앱 배경과 미리보기 작업대 |
| `--surface` | `#ffffff` | 설정 panel, 입력, 툴바, 썸네일 strip |
| `--ink` | `#171717` | 본문, 아이콘, 강한 구조선 |
| `--muted-ink` | `#676762` | 설명과 비활성 label |
| `--line` | `#d4d4ce` | 일반 테두리와 row 구분선 |
| `--primary` | `#1d4ed8` | 주요 CTA, focus, 선택, 진행 |
| `--primary-pressed` | `#0037b0` | 눌림·활성 상태의 넓은 면 |
| `--primary-soft` | `#e8efff` | hover와 약한 선택 배경 |
| `--neutral-soft` | `#e8e8e3` | 비활성·중립 배경 |
| `--success` | `#18794e` | 실제 완료 상태 |
| `--warning` | `#a15c00` | 실제 주의 상태 |
| `--error` | `#b42318` | 오류와 삭제 동작 |

기존 코드에서 사용하는 `--base`, `--panel`, `--panel-hi`, `--rebate`, `--bone`, `--edge`는 각각 위 토큰의 alias다. 새 CSS에는 의미 기반 토큰을 우선 사용한다.

블랙 테마는 `html[data-theme="dark"]`에서 `--canvas #171717`, `--surface #000000`, `--ink #ffffff`, `--muted-ink #adada8`, `--line #484844`, `--neutral-soft #262622`만 교체한다. 기본 버튼·레이아웃 CSS를 공유하며, 기존의 밝은 코발트 hover·선택 면에서는 어두운 글자를 유지한다. 빈 화면 안내의 hover는 어두운 `neutral-soft`를 사용한다. 브라우저 기본 입력·스크롤바에는 `color-scheme: dark`를 적용한다.

테마는 `frame.ui.theme`에 패널 폭·배율·경계 표시 설정과 병합 저장한다. 설정이 없거나 올바르지 않으면 화이트를 사용한다. 프로젝트 파일·사진·로고·Canvas 결과에는 테마를 적용하지 않으며 CSS `filter: invert()`도 사용하지 않는다.

### 간격, 선, 모서리

| 역할 | 값 |
|---|---:|
| 조밀한 내부 간격 | `4px` |
| 기본 grid | `8px` |
| compact gutter | `16px` |
| wide gutter | `24px` |
| 버튼·아이콘·체크박스 레이블 touch target | `48px` |
| 스트립 순서 아이콘 버튼 (기본 / 터치 포인터) | `28px` / `40px` |
| app bar 높이 | `64px` |
| 일반 row·panel 선 | `1px` |
| outline action·focus | `2px` |
| workspace·rail·strip 구조선 | `3px` |
| 큰 panel 반경 | `0` |
| 버튼 반경 | `2px` |
| 입력·popover 반경 | `4px` |

일반 여백은 `8, 16, 24, 32px` 순서를 우선한다. 4px은 label과 아이콘 사이 같은 광학 보정에만 사용한다.

## 3. 타이포그래피

- 본문과 headline은 `system-ui, Apple SD Gothic Neo, Malgun Gothic` 계열 산세리프를 사용한다.
- 구조 label, 버튼, 비율, px, 순번과 파일명은 시스템 monospace를 사용한다.
- 숫자 입력과 줌 배율에는 `tabular-nums`를 적용해 값이 바뀌어도 정렬을 유지한다.
- wordmark는 `24px / 800`, 빈 상태 headline은 desktop `36px / 1.1 / 800`, compact `28px`이다.
- section label은 `12px / 700` monospace이며 `01 /`, `02 /` 순번을 함께 표시한다.
- 기본 본문은 `14px / 1.5`, 보조 설명은 `12px / 1.5`다.
- 한글 본문을 모두 대문자로 바꾸지 않는다. 넓은 자간은 짧은 구조 label에만 제한한다.

## 4. App shell과 반응형

### Expanded · `1100px` 이상

- `.shell`은 중앙 workspace와 우측 설정 rail의 2열이다.
- workspace는 남은 너비를 사용하고 rail은 사용자 설정 `--railw`를 사용한다(초기값과 CSS fallback `500px`). 기존 사용자가 직접 저장한 너비는 유지한다.
- 높이는 `100dvh`이며 미리보기 workspace와 설정 rail은 각자 필요한 overflow를 처리한다.
- masthead는 높이 `64px`, 좌우 gutter `24px`이며 미리보기와 같은 배경을 쓴다. 두 영역 사이 구분선은 없다.
- rail은 흰 surface, 좌측 `3px` ink 구조선, 내부 gutter `24px`이다.

### Medium · `720px` 이상 `1100px` 미만

- 필수 기능을 줄이지 않고 한 열로 전환한다.
- 빈 상태는 미리보기 workspace를 한 화면 높이로 먼저 보여주고 설정 rail을 그 아래 배치한다. 사진을 불러오면 `.table`을 `display:contents`로 두어 미리보기만 `sticky; top:0`으로 고정한다. 높이는 `clamp(240px,48dvh,520px)`이며 헤더·사진 스트립·설정은 페이지에서 스크롤된다.
- rail의 좌측선은 상단 `3px` 구조선으로 바뀐다.
- 별도 navigation destination이 없으므로 navigation rail이나 하단 navigation을 만들지 않는다.

### Compact · `720px` 미만

- 좌우 gutter는 `16px`이다.
- 헤더는 PhotoFrame·사진 추가·개인 설정을 한 행으로 배치한다. 별도 설정 이동 버튼은 두지 않는다.
- 2열·3열 form row는 한 열로 쌓고 범위 선택, 글꼴 도구도 세로로 배치한다.
- 빈 상태는 viewport 안에서 스크롤할 수 있고 headline을 `28px`로 낮춘다.
- 줌바는 너비 안에서 **4열 × 2행** grid가 되어 모든 기능을 유지한다.
- strip과 rail 하단에는 `env(safe-area-inset-bottom)`을 반영한다.
- 아래로 스크롤해 설정에 접근하고 레일의 `↑ 미리보기로`로 돌아온다. 사진이 있을 때는 미리보기가 고정되므로 설정을 스크롤하면서 결과를 확인하고, 레일의 이동 버튼은 일반 흐름에 두어 미리보기를 덮지 않는다.

## 5. 화면 구조와 컴포넌트

### Masthead

- `<header>` 안의 `<h1>` wordmark, 작업 중에도 보이는 `＋ 사진 추가`, 48×48px 개인 설정 버튼을 한 행으로 배치한다. 소개 문구는 제공하지 않는다.
- 미리보기와 같은 배경에 구분선·그림자 없이 이어 배치한다.

### 빈 상태와 사진 입력

- 빈 상태 전체가 키보드로 실행 가능한 사진 선택 target이다.
- 흰 surface, 1px ink frame, 좌측 8px cobalt marker로 다음 동작을 표시한다.
- `01 / INPUT`, headline, 파일 안내, 3단계 사용법, 로컬 처리 안내 순으로 읽힌다.
- hover는 `--primary-soft`, keyboard focus는 3px cobalt outline을 사용한다.
- 사진은 브라우저 밖으로 전송하지 않는다는 문구를 항상 노출한다.
- 앱에는 내장 예제 버튼·생성기를 두지 않고 사용자가 직접 고른 로컬 사진으로 시작한다.

### 미리보기와 줌바

- 미리보기 canvas에는 장식 shadow를 쓰지 않고 1px line outline만 둔다.
- 줌바는 흰 surface와 2px ink frame으로 미리보기 위에 놓인다.
- 버튼은 최소 48×48px이고 사이를 1px line으로 나눈다.
- 화면 맞춤은 실제 도구막대 높이를 제외한 공간에 사진을 배치해 2행 도구막대와 겹치지 않는다.
- 활성 토글은 cobalt 면 + 흰 글자, hover는 primary-soft, 비활성은 neutral-soft로 표현한다.
- 경계 넘침은 `--error`와 점 표식을 함께 써 색만으로 알리지 않는다.
- 두 손가락 줌·팬은 기존 canvas transform만 바꾼다. 표시·레이아웃 설정에는 요소와 이동 간격 선택, 48px 방향 버튼, 선택 요소 위치 초기화를 제공하고 기존 배치 되돌리기와 연결한다.

### 사진 strip

- 흰 surface와 상단 3px 구조선으로 workspace와 분리한다.
- 현재 사진은 3px ink frame, 배치 선택 사진은 3px cobalt outline과 native checkbox로 구분한다.
- 장별 정보와 EXIF 상태는 문자 marker를 함께 표시한다.
- 삭제는 항상 노출하고 `--error`를 사용한다. 필수 action을 hover에만 의존하지 않는다.
- 사진 표시 영역 아래에 선택 레이블과 삭제 버튼을 각각 48×48px로 분리한다. 현재 사진 테두리와 배치 선택 외곽선은 함께 보이며, 목록 갱신 후에도 키보드 초점을 유지한다.
- 중복 상태 줄과 삭제 취소 버튼을 제거하고, 썸네일 아래 맨 하단에 `←` / `→` 순서 이동 버튼만 둔다. 기본 28×28px, 터치 포인터에서는 40×40px이며 한국어 접근성 이름과 툴팁을 유지한다. 사진이 없으면 버튼 행을 숨긴다. 현재 사진·선택 장수·촬영 정보 범위는 촬영 정보 패널에서 확인한다.

### 설정 rail

- section은 둥근 card 대신 heading, 여백, 1px divider로 구분한다.
- section heading에는 화면 순서에 따른 `01 /`, `02 /` marker를 붙인다.
- 접이식 panel은 반경 0, 1px line frame이며 열림 상태를 `＋/−`와 구조선으로 표시한다.
- 프레임 선택 버튼에는 선과 면만으로 만든 작은 스타일 예시를 넣고 텍스트 이름을 함께 유지한다.
- 촬영 정보 적용 범위와 스타일·방향 공통 배치를 다른 안내 문장으로 구분하며, 현재 프레임에서 의미 없는 설정 행은 숨긴다.
- 내보내기에는 비율·형식·품질·파일 제목과 저장 폴더·전체·현재 장 동작을 표시한다. 파일 제목·서명에는 특정 여행명·사용자 ID 예시를 넣지 않고, 파일명 규칙은 첫 로드부터 별도 안내한다.
- 형식·품질·파일 제목 행은 보이는 입력 수에 맞춰 채운다. PNG에서는 품질 입력을 숨겨 빈 자리를 남기지 않고 JPEG에서만 표시한다.

### 버튼과 입력

- Primary button: cobalt 배경, 흰 글자, 2px cobalt border.
- Secondary button: 흰 배경, 2px ink border.
- Segmented control: 2px ink 외곽선과 1px 내부선, 활성 cell 전체를 pressed cobalt로 채운다.
- 입력: 흰 배경, 1px line, 반경 4px, 최소 높이 48px, 좌우 padding 16px. 일반 텍스트 라벨은 32px 안에서 정렬해 행 사이의 과도한 빈 공간을 줄인다.
- focus는 2px cobalt outline과 2px offset으로 항상 보이게 한다.
- disabled는 neutral-soft 배경과 muted ink를 함께 사용한다.
- 파괴적 action은 `--error`, 경고 panel은 `--warning`으로 primary와 구분한다.
- 장비·레이아웃·로고 팔레트의 적용과 삭제는 형제 버튼으로 분리하고, 저장 목록에서 삭제하기 전에 확인한다.
- 로고 목록의 투명 이미지에는 테마와 무관한 흰색/회색 체크 배경을 둔다. 이미지 색을 반전하지 않으며 이 배경은 Canvas 결과에 포함하지 않는다.
- 개인 설정 팝업은 명시적인 닫기 버튼, Tab 초점 순환, Escape 닫기와 시작 버튼 초점 복귀를 지원한다.
- UI 배율을 줄이면 조작 영역 토큰을 역보정해 주요 버튼의 실제 크기를 유지한다. `hidden` 속성은 컴포넌트의 grid/flex 표시보다 우선한다.
- 패널 폭·UI 배율에 따라 실제 내부 너비가 280px 이하가 되면 container query로 입력을 한 열, 프레임 스타일을 2×2로 배치한다. 화면이 넓어도 좁힌 패널에서 필수 버튼이 잘리지 않는다.

### 진행과 피드백

- 내보내기 progress는 cobalt를 사용하고 현재 파일·전체 수를 인접한 live text로 제공한다.
- 프로젝트 상태는 `저장 필요`·`마지막 저장`·`저장 확인 필요`를 문구와 상태색으로 구분한다. 다운로드 요청을 실제 저장 완료처럼 초록색 완료로 표현하지 않는다.
- 토스트는 하단 중앙에 나타나되 미리보기 주요 내용을 가리지 않는다.
- reduced motion 환경에서는 transition을 제거한다.

## 6. UI와 합성 결과물의 분리

이 문서의 토큰과 breakpoint는 **브라우저 UI에만 적용**한다. 합성 canvas는 `render()`라는 하나의 경로를 미리보기와 내보내기가 공유하며, UI를 밝은 Structural Modernism으로 바꿔도 결과물의 색·비율·배치는 바뀌지 않는다.

- Canvas 색은 JavaScript 상수 `C`가 소유한다: `base #0d0c0a`, `edge #e8873a`, `rebate #8a8378`, `paper #ffffff`, `ink #2a2723`, `bandDark #14130f`, `bandDarkText #cfc9bd`. 인스탁스 종이는 화면 테마·사진 방향에 관계없이 흰색이다.
- 필름 스트립, 인스탁스, 상·하단 여백의 크기와 모든 요소 위치는 사진 폭 `W` 기준 비율과 스타일·방향별 profile이 소유한다.
- CSS UI 토큰을 `C`, `render()`, `withProfile()`의 값으로 재사용하지 않는다.
- 경계 box, handle, snap guide는 미리보기 전용 overlay이며 내보내기에 포함하지 않는다.
- 프레임 결과 디자인을 바꾸는 작업은 UI 테마 변경과 별도 기능 변경으로 취급하고 관련 feature 문서를 함께 갱신한다.

## 7. 접근성 점검

- 모든 필수 action은 touch와 keyboard로 접근할 수 있고 접근 가능한 이름을 가진다.
- hover 없이 사진 선택, 설정 변경, 프로젝트 저장과 내보내기를 완료할 수 있어야 한다.
- focus indicator를 제거하지 않는다.
- 선택, 오류, EXIF·장별 상태는 색 이외의 outline, checkbox, 문자 또는 문구를 함께 쓴다.
- 360px, 720px, 1100px 이상에서 같은 action이 유지되어야 한다.
- 신선한 localStorage 상태에서 초기화가 끝까지 실행되고 console 오류가 없어야 한다.
- UI 변경 후에도 같은 `render()` 입력의 미리보기와 내보내기 결과가 일치해야 한다.
