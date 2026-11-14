# NEON STRIKER 🚀

한 손가락으로 즐기는 **네온 아케이드 우주 슈팅**. 아이폰 사파리와 PC 브라우저에서
빌드 없이 바로 실행되는 단일 정적 웹앱입니다.

**▶ 지금 플레이: <https://jhparkk.github.io/shooting-game/>**

![NEON STRIKER](https://img.shields.io/badge/NEON-STRIKER-22e6ff?style=for-the-badge)
![no build](https://img.shields.io/badge/build-none-ff3cbe?style=for-the-badge)
![mobile ready](https://img.shields.io/badge/iOS-Safari-a06aff?style=for-the-badge)

---

## 게임 소개

어두운 성운을 배경으로 네온 빛 기체를 조종해 끝없이 밀려오는 적을 격추합니다.
가만히 있어도 **자동 연사**되기 때문에, 오직 **회피와 위치 선정**에만 집중하면 됩니다.
3웨이브마다 등장하는 보스를 넘기며 최고 점수에 도전하세요.

- **아이와 함께**: 조작이 단순해서 처음 잡아도 바로 플레이할 수 있습니다. (체력 3칸, 후한 피격 판정)
- **혼자서**: 콤보 배율(최대 x4)과 웨이브 보너스로 점수를 극한까지 끌어올리는 기록 경쟁.

## 조작

| 환경 | 조작 |
| --- | --- |
| 📱 모바일 | 화면을 **한 손가락으로 드래그** (기체가 손가락보다 살짝 위에서 따라옵니다) |
| 🖥 PC | **마우스 이동** 또는 **방향키 / WASD** |
| 💣 필살기 | 우하단 💣 버튼 또는 **Space** |
| ⏸ 일시정지 | 우상단 ❚❚ 또는 **P / Esc** |
| 🔊 음소거 | 우상단 스피커 버튼 또는 **M** |

발사는 자동입니다. 시작 화면에서 **시작하기**를 누르면 바로 시작됩니다.

## 게임 요소

### 적
| 적 | 특징 |
| --- | --- |
| 정찰기 (분홍) | 아래로 직진하며 사인 곡선으로 흔들립니다. |
| 요격기 (주황) | 빠르게 지그재그로 내려오며 **조준 사격**을 합니다. |
| 장갑기 (빨강) | 체력이 높은 육각 장갑 기체. **3방향 확산탄**을 쏩니다. |
| 보스 (보라) | 3·6·9… 웨이브마다 등장. 부채꼴 조준탄, 원형 탄막, 3점사를 번갈아 사용합니다. |

### 아이템
| 아이템 | 효과 |
| --- | --- |
| **M** 멀티샷 | 15초간 3발 동시 발사 |
| **S** 스피드업 | 15초간 연사 속도·탄속 증가 |
| **D** 실드 | 피격 1회를 대신 막아주는 보호막 |
| **B** 필살기 | 폭탄 +1 (최대 3개). 화면의 적탄을 지우고 모든 적에게 큰 피해 |

### 점수
- 적 격추 점수 × 콤보 배율(콤보 10단위마다 +1, 최대 **x4**)
- 웨이브 클리어 보너스 `100 × 웨이브`
- 최고 기록은 브라우저 `localStorage` 에 저장됩니다.

## 모바일 최적화

- `viewport-fit=cover` + `env(safe-area-inset-*)` 로 노치·홈 인디케이터 회피
- `touch-action: none`, `overscroll-behavior: none`, `preventDefault` 로
  드래그 중 화면 튕김·스크롤·확대·롱프레스 완전 차단
- 터치 지점보다 **약 110px 위**에 기체를 두어 손가락에 기체가 가려지지 않음
- `devicePixelRatio`(최대 2배) 대응 고해상도 캔버스, 프레임 타임 클램프
- `shadowBlur` 대신 다중 스트로크로 네온 발광을 흉내 내 모바일 GPU 부담 최소화
- 백그라운드 전환·창 포커스 아웃 시 자동 일시정지

## 파일 구성

```
index.html     # 화면 구조(HUD·시작·일시정지·게임오버)
style.css      # 네온 아케이드 테마, 세이프 에어리어, 반응형
js/audio.js    # Web Audio API 실시간 합성 효과음 (오디오 파일 없음)
js/game.js     # 게임 루프·적 AI·보스·파티클·충돌·입력·저장
.nojekyll      # GitHub Pages 가 정적 파일을 그대로 서빙하도록
```

외부 라이브러리, 폰트 CDN, 이미지 파일을 전혀 사용하지 않습니다.
모든 그래픽은 Canvas 2D 로, 모든 소리는 오실레이터로 그 자리에서 그립니다.

## 로컬에서 실행

```bash
# 방법 1: 그냥 열기
open index.html

# 방법 2: 로컬 서버 (권장)
python3 -m http.server 8000
# → http://localhost:8000
```

## GitHub Pages 배포

1. 저장소 **Settings → Pages**
2. **Source: Deploy from a branch**, **Branch: `main` / `/ (root)`** 선택 후 저장
3. 1~2분 뒤 <https://jhparkk.github.io/shooting-game/> 접속

## 기술 메모

- 순수 `requestAnimationFrame` 루프 + 델타 타임(최대 50ms) 기반 물리
- 원-패스 배열 + `compact()` 로 매 프레임 엔티티 정리 (GC 부담 최소화)
- Web Audio: 사각파·삼각파 오실레이터 + 노이즈 버퍼로 레트로 아케이드 사운드 합성,
  첫 사용자 제스처에서 `AudioContext` 활성화(iOS 정책 대응)
- 화면 크기별 스케일 팩터(`SC`)로 기체·적·탄 크기와 속도를 자동 보정
