# simulation_react

리액트로 개발하는 mr2s 시뮬레이션입니다.

CSV로 그래프(간선 목록)를 입력하면 자동 레이아웃 후 노드를 드래그로 조정할 수 있고,
"Generate Paths"를 누르면 각 간선의 weight에 비례한 폭을 가진 골목(복도)이 실제
이동 공간으로 생성됩니다. 사람(작은 원)은 리프 노드 사이를
**Social Force Model**(Helbing & Molnár) 기반으로 이동하며, 서로 가까워지면
사회적 반발력으로 간격을 유지하고 밀집 시에는 몸통 접촉력/마찰로 실제처럼
밀쳐집니다. 간선 방향 최적화는 배포된 외부 **mr2s-backend** API를 호출해
방향 화살표/점수를 오버레이로 볼 수 있습니다.

## 아키텍처

```text
frontend/   React + TypeScript + Vite, 탑뷰 캔버스 + Social Force Model 군중 시뮬레이션
```

간선 방향 최적화 백엔드는 이 저장소에 포함되어 있지 않고, 배포된
**`https://quantum.yunseong.dev`** (mr2s-backend, FastAPI)를 사용합니다.
API 명세는 [BACKEND_REFERENCE.md](BACKEND_REFERENCE.md)를 참고하세요.
사용 엔드포인트: `POST /api/v1/mr2s`, `/api/v1/raw-sa`, `/api/v1/brute-force`.

### 백엔드 연동 방식

- **dev**: 백엔드의 CORS 허용 목록에 localhost가 없으므로, Vite dev 서버의
  proxy(`/mr2s-api` → `https://quantum.yunseong.dev`)를 경유합니다
  (`frontend/vite.config.ts`). 로컬에서 mr2s-backend를 직접 띄웠다면
  `VITE_PROXY_TARGET=http://localhost:8000`으로 대상을 바꿀 수 있습니다.
- **prod**: 빌드 시 `VITE_API_BASE_URL=https://quantum.yunseong.dev`를 설정해
  직접 호출합니다. 단, 빌드 결과물을 호스팅하는 오리진이 백엔드의 CORS
  허용 목록(`quantum-guardians.github.io`, `mr2s.vercel.app`,
  `qi4uinpnu.vercel.app`)에 있어야 하며, 새 도메인은 백엔드 `main.py`의
  `allow_origins`에 추가가 필요합니다.
- 설정 예시는 `frontend/.env.example` 참고.

## 실행 방법

```bash
cd frontend
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
2. 자동 배치된 노드를 캔버스에서 드래그해 위치를 조정합니다.
3. "Number of people"에 원하는 인원 수를 직접 입력하고 "Generate Paths"를
   누르면 weight에 비례한 폭의 골목이 생성되고, 입력한 수만큼 사람이 리프
   노드 사이를 오가며 이동을 시작합니다. Play/Pause로 시뮬레이션을
   제어하고, 시뮬레이션 도중에도 숫자를 바꾼 뒤 "Add"를 누르면 그만큼
   사람이 추가로 투입됩니다.
4. Solver(MR2S(QUBO) / Simulated Annealing / Brute Force)를 선택하고
   "Run Solver"를 누르면 방향 화살표와 score(Optimized/Bidirectional APSP)가
   표시됩니다.
   - 점수가 "not strongly connected"로 표시되면 방향 그래프가 강연결이
     아니라는 뜻이며(서버 응답 `-1`), 일부 경로가 불가능할 수 있다는
     경고가 함께 표시됩니다.
   - 최적화는 서버에서 10초 제한이 있어 초과 시 타임아웃 메시지가
     표시됩니다. Brute Force는 간선 수에 지수적(2^E)이므로 작은 그래프
     전용입니다.

## 군중 이동 모델 (Social Force Model)

에이전트 이동은 Helbing & Molnár의 Social Force Model을 따릅니다
(`frontend/src/simulation/socialForce.ts`):

- **구동력**: 희망 속도 × 다음 웨이포인트 방향으로 이완 시간 τ에 걸쳐 가속
- **에이전트 간 반발력**: 거리에 지수적으로 감소하는 사회적 반발 +
  접촉 시 몸통력(body force)과 미끄럼 마찰(sliding friction)
- **벽 반발력**: 복도 벽/허브 테두리 세그먼트에 대해 동일한 형태의 힘

경로 탐색(웨이포인트)은 solver가 정한 간선 방향을 존중하는 Dijkstra
최단경로를 사용합니다. 튜닝 상수는 `frontend/src/simulation/presets.ts`에
모여 있습니다.

## 테스트

```bash
cd frontend
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
