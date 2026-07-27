# simulation_react

리액트로 개발하는 mr2s 시뮬레이션입니다.

CSV로 그래프(간선 목록)를 입력하면 자동 레이아웃 후 노드를 드래그로 조정할 수 있고,
"Random graph"에서 2~12개 노드를 선택하면 연결된 테스트 그래프를 즉시 만들 수 있습니다.
"Generate Paths"를 누르면 각 간선의 weight에 비례한 폭을 가진 골목(복도)이 실제
이동 공간으로 생성됩니다. 사람(작은 원)은 리프 노드 사이를
**Social Force Model**(Helbing & Molnár) 기반으로 이동하며, 서로 가까워지면
사회적 반발력으로 간격을 유지하고 밀집 시에는 몸통 접촉력/마찰로 실제처럼
밀쳐집니다. 여러 사람과 벽에 동시에 압축되어 임계 압력이 3초간 지속되면
사망하며, 화면에는 붉은 X와 사망 통계로 표시됩니다. 간선 방향 최적화는
배포된 외부 **mr2s-backend** API를 호출해
방향 화살표/점수를 오버레이로 볼 수 있습니다.

## 아키텍처

```text
src/      React 컴포넌트, API 연동, Social Force Model 시뮬레이션
public/   정적 리소스
docs/     API 및 백엔드 참고 문서
```

간선 방향 최적화 백엔드는 이 저장소에 포함되어 있지 않고, 배포된
**`https://quantum.yunseong.dev`** (mr2s-backend, FastAPI)를 사용합니다.
API 명세는 [docs/BACKEND_REFERENCE.md](docs/BACKEND_REFERENCE.md)를 참고하세요.
사용 엔드포인트: `POST /api/v1/mr2s`, `/api/v1/raw-sa`, `/api/v1/brute-force`.

### 백엔드 연동 방식

- **dev**: 백엔드의 CORS 허용 목록에 localhost가 없으므로, Vite dev 서버의
  proxy(`/mr2s-api` → `https://quantum.yunseong.dev`)를 경유합니다
  (`vite.config.ts`). 로컬에서 mr2s-backend를 직접 띄웠다면
  `VITE_PROXY_TARGET=http://localhost:8000`으로 대상을 바꿀 수 있습니다.
- **prod (Vercel)**: `vercel.json`의 rewrite가 `/mr2s-api/*`를
  `https://quantum.yunseong.dev/*`로 서버 측에서 전달합니다. 브라우저 입장에서는
  같은 오리진 요청이라 CORS 허용 목록과 무관합니다. dev proxy는 빌드 결과물에
  포함되지 않으므로 이 rewrite가 없으면 `/mr2s-api/...`가 404가 납니다.
- **prod (그 외 호스팅)**: rewrite를 걸 수 없다면 빌드 시
  `VITE_API_BASE_URL=https://quantum.yunseong.dev`로 직접 호출합니다. 이 경우
  호스팅 오리진이 백엔드의 CORS 허용 목록(`quantum-guardians.github.io`,
  `mr2s.vercel.app`, `qi4uinpnu.vercel.app`)에 있어야 하며, 새 도메인은 백엔드
  `main.py`의 `allow_origins`에 추가가 필요합니다.
- 설정 예시는 `.env.example` 참고.

## 실행 방법

```bash
npm install
npm run dev
```

브라우저에서 접속:

```text
http://localhost:5173
```

## 사용 흐름

1. 왼쪽 패널에 `node1,node2,weight` 형식의 CSV(간선 목록)를 붙여넣고
   "Parse & Layout"을 누릅니다. (예: `A,B,1` / `B,C,2` / `C,D,1`)
   CSV 대신 2~12개 노드 수를 고른 뒤 "Random graph → Generate"를 누르면
   항상 연결된 임의 그래프가 생성되고 즉시 배치됩니다.
   "Layout"에서 배치 방식을 고를 수 있습니다: `Force-directed`(기존 기본값)
   또는 `Planar (no crossings)`(간선이 교차하지 않는 평면 임베딩).
2. 자동 배치된 노드를 캔버스에서 드래그해 위치를 조정합니다.
3. "Number of people"에 원하는 인원 수를 직접 입력하고 "Generate Paths"를
   누르면 weight에 비례한 폭의 골목이 생성되고, 입력한 수만큼 사람이 리프
   노드 사이를 오가며 이동을 시작합니다. Play/Pause와 배속 선택으로
   시뮬레이션을 제어하고, 시뮬레이션 도중에도 숫자를 바꾼 뒤 "Add"를
   누르면 그만큼 사람이 추가로 투입됩니다.
4. Solver(MR2S(QUBO) / Simulated Annealing / Brute Force)를 선택하고
   "Run Solver"를 누르면 방향 화살표와 score(Optimized/Bidirectional APSP)가
   표시됩니다.
   - 점수가 "not strongly connected"로 표시되면 방향 그래프가 강연결이
     아니라는 뜻이며(서버 응답 `-1`), 일부 경로가 불가능할 수 있다는
     경고가 함께 표시됩니다.
   - 최적화는 서버에서 10초 제한이 있어 초과 시 타임아웃 메시지가
     표시됩니다. Brute Force는 간선 수에 지수적(2^E)이므로 작은 그래프
     전용입니다.

## 평면 그래프 임베딩 (Planar layout)

`Planar (no crossings)` 모드는 간선이 서로 교차하지 않도록 노드를 배치합니다
(`src/simulation/planarEmbedding.ts`, `src/simulation/planarLayout.ts`):

1. 그래프를 이중연결 블록으로 나눈 뒤 각 블록을 DMP(Demoucron–Malgrange–
   Pertuiset) 경로추가 알고리즘으로 임베딩하고, 절단점에서 회전순서를 이어
   붙여 그래프 전체의 조합적 평면 임베딩을 만듭니다.
2. 각 면 안에 현(chord)을 추가해 삼각화하면 3-연결 극대평면 그래프가 되고,
   Tutte 무게중심 임베딩(외부 면을 볼록 다각형에 고정하고 나머지 노드는
   이웃의 평균 위치, 선형계 풀이)으로 좌표를 구합니다. 삼각화용 가상 간선은
   좌표 계산에만 쓰고 결과에서 제외합니다.
3. Tutte 좌표는 노드가 중앙으로 몰리므로, 교차가 생기지 않는 이동만 채택하는
   반발력 완화 단계로 간격을 벌립니다.
4. 마지막에 실제 좌표에서 교차 수를 세어 0이 아니면 실패로 처리합니다.

비평면 그래프(K5, K3,3 등)는 평면 배치가 불가능하므로 force-directed 배치로
자동 폴백하고 경고를 표시합니다. 절단점·다리·리프 노드가 있는 일반적인 복도
그래프도 그대로 처리됩니다.

## 군중 이동 모델 (Social Force Model)

에이전트 이동은 Helbing & Molnár의 Social Force Model을 따릅니다
(`src/simulation/socialForce.ts`):

- **구동력**: 희망 속도 × 다음 웨이포인트 방향으로 이완 시간 τ에 걸쳐 가속
- **에이전트 간 반발력**: 거리에 지수적으로 감소하는 사회적 반발 +
  접촉 시 몸통력(body force)과 미끄럼 마찰(sliding friction)
- **벽 반발력**: 복도 벽/허브 테두리 세그먼트에 대해 동일한 형태의 힘
- **압력 사망**: 사람·벽과의 동시 압축도를 누적하고, 압력 3.5 이상이
  시뮬레이션 시간으로 3초 지속될 때 사망 처리. 압력이 풀리면 누적 노출은
  빠르게 감소

경로 탐색(웨이포인트)은 solver가 정한 간선 방향을 존중하는 Dijkstra
최단경로를 사용합니다. 튜닝 상수는 `src/simulation/presets.ts`에
모여 있습니다.

## 테스트

```bash
npm run test
```

## 알려진 제한 사항 / 다음 단계

- 골목의 교차점(hub)은 현재 완전히 열린 원으로 처리됩니다.
- 외부 API는 간선 가중치를 정수로만 받으므로 소수 가중치는 반올림되며
  경고가 표시됩니다. 같은 두 노드 사이의 중복 간선은 첫 간선만
  전송됩니다.
- 외부 API는 bridge(다리 간선)를 포함한 모든 간선에 방향을 강제하므로,
  bridge가 있는 그래프는 강연결이 될 수 없어 점수가
  "not strongly connected"로 표시됩니다.
