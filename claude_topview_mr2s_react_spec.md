# Claude 작업 지시서 — MR2S 모듈 기반 React 탑뷰 군중/경로 방향 제어 시각화

## 0. 목표

이 프로젝트의 목표는 기존 `mr2s_module`을 활용하여, React 웹 화면에서 **탑뷰(top-view) 형태의 군중 이동 / 밀도 / 간선 방향 제어 결과**를 시각화하는 것이다.

화면 컨셉은 다음과 같다.

- 긴 복도 또는 통로를 위에서 내려다보는 형태
- 사람들은 작은 원, 아이콘, sprite, 또는 단순 particle로 표현
- 공간은 grid/cell 기반으로 표현
- 밀도는 색상으로 표현
  - 회색: 비통행/벽/외부 영역
  - 연두/녹색: 낮은 밀도 또는 통행 가능 영역
  - 갈색/붉은색: 높은 밀도 또는 위험 구간
- 그래프 overlay를 켜면 node/edge가 보이고, edge orientation 결과가 화살표로 표시됨
- 사용자는 Low Density / Intermediate Density / Critical High Density 같은 preset을 선택할 수 있음
- 사용자는 solver를 선택하고, 기존 `mr2s_module`의 결과를 받아 시각화함

중요: React에서 Python 모듈을 직접 import하려고 하지 말 것. `mr2s_module`은 Python 로직이므로, React는 API를 통해 backend와 통신하는 구조로 만든다.

---

## 1. 전체 아키텍처

```text
frontend/
  React + TypeScript + Vite
  - 탑뷰 시각화
  - 그래프 overlay
  - solver 선택 UI
  - density preset 선택 UI
  - API 호출

backend/
  FastAPI 또는 기존 Python 서버
  - mr2s_module 호출 wrapper
  - graph 생성 / 변환
  - solver 실행
  - 결과 JSON 반환

mr2s_module/
  기존 알고리즘 모듈
  - domain
  - cycle
  - edge_orient
  - qubo
  - evaluator
  - solver
  - util
```

React는 시각화와 사용자 조작만 담당한다. 핵심 알고리즘은 반드시 기존 `mr2s_module`을 재사용한다.

---

## 2. 반드시 지킬 원칙

1. `mr2s_module`의 알고리즘을 React 쪽에서 재구현하지 않는다.
2. React는 backend API 결과를 받아서 그린다.
3. 처음부터 완벽한 군중 물리 시뮬레이션을 만들지 않는다.
4. 1차 목표는 다음 3개를 제대로 보이게 하는 것이다.
   - 공간 grid
   - 사람 particle
   - 방향이 지정된 graph edge 화살표
5. 이후에 density update, agent 이동, 위험도 계산을 점진적으로 추가한다.
6. 기존 module의 값 타입과 solver 구조는 최대한 그대로 존중한다.
7. `sample_score_ranker.py`가 아직 export되지 않은 상태라면 `evaluator/__init__.py`에 등록한다.

---

## 3. 기존 Python 모듈 구조 요약

현재 사용할 수 있는 모듈 구조는 다음과 같다.

```text
domain/
  Graph
  Edge
  AdjEntry
  Score
  Solution
  GraphPartitionResult
  OrientationResult
  OrientedEdges
  EmbeddableGraphPartition
  EmbeddingEstimate
```

`domain`은 로직 없는 값 타입이다. React로 넘길 JSON schema를 만들 때 이 구조를 참고한다.

```text
cycle/
  FaceClusterPartition.run(graph) -> GraphPartitionResult
  SnowballFaceClusterer.run(...)
  KMeansFaceClusterer.run(...)
  BalancedFaceGraphClusterer.run(...)
```

`cycle`은 평면 그래프를 face-cluster 기준으로 분할하는 영역이다. 시각화에서는 partition 결과를 색으로 구분할 수 있다.

```text
edge_orient/
  Robbin.run(graph) -> OrientedEdges
  Tjoin.run(graph) -> OrientedEdges
  IteratedLocalSearch(max_iter, patience, is_relaxed, perturb_strength)
```

`edge_orient`는 간선 방향 결정용이다. React에서는 이 결과를 화살표로 그린다.

```text
qubo/
  FlowPolyGenerator.run(graph)
  NHopPolyGenerator(SmallWorldSpec).run(graph)
  QuboSolver(ranker, sampler, num_reads)
```

`qubo`는 QUBO 생성 및 solver 실행 영역이다. frontend에서는 solver 옵션으로 노출한다.

```text
evaluator/
  Evaluator().run(solution) -> Score
  ApspSumRanker().run(solution) -> float
  SampleScoreRanker().run(solution) -> float
```

`SampleScoreRanker`는 새 파일 `mr2s_module/evaluator/sample_score_ranker.py`에 있고, 아직 `evaluator/__init__.py`에 export되지 않았을 가능성이 있다. 실제 진입점에서 사용하려면 등록한다.

```text
solver/
  MR2SSolver
  BaseEdgeOrientationSolver(edge_orienter, evaluator)
  RobbinMR2SSolver
  IlsMR2SSolver
  SAMR2SSolver
  QuboMR2SSolver
  DnCMr2sSolver
```

최상위 solver는 전부 `run(graph) -> Solution` 형태로 맞춘다.

```text
solver/predefined.py
  create_robbin_solver
  create_ils_solver
  create_sa_solver
  create_qubo_solver
  create_qubo_sa_solver
  create_qubo_qa_solver
  create_dnc_sa_solver
  create_dnc_qubo_solver
  create_dnc_qubo_sa_solver
  create_dnc_qubo_qa_solver
```

React UI에서는 이 predefined factory들을 solver preset으로 선택할 수 있게 만든다.

```text
util/
  estimate_required_qubits(bqm, target_graph)
  map_binary_poly_to_bqm
  robbins_orient
  build_dual_base
  enumerate_faces
  domain_graph_to_networkx
  empty_binary_sample_set
```

`util`은 backend 쪽 graph 변환, face 계산, embedding estimate에 사용한다.

---

## 4. 권장 구현 방향

### 4.1 Backend API

FastAPI로 얇은 wrapper를 만든다.

권장 파일 구조:

```text
backend/
  app.py
  schemas.py
  graph_builder.py
  solver_service.py
  requirements.txt
```

### 4.2 Backend endpoint 설계

#### `GET /api/health`

서버 상태 확인.

응답 예시:

```json
{
  "ok": true,
  "module": "mr2s_module",
  "version": "dev"
}
```

#### `POST /api/graph/from-grid`

grid/cell 기반 입력을 받아 `mr2s_module.domain.Graph`로 변환 가능한 graph JSON을 만든다.

요청 예시:

```json
{
  "width": 30,
  "height": 8,
  "blockedCells": [[0,0], [0,1]],
  "exitCells": [[29,3], [29,4]],
  "densityMap": [[0.0, 0.1, 0.2]],
  "connectivity": "4-neighbor"
}
```

응답 예시:

```json
{
  "graph": {
    "nodes": [
      { "id": "3,4", "x": 3, "y": 4 }
    ],
    "edges": [
      { "id": "e1", "source": "3,4", "target": "4,4", "weight": 1.0 }
    ]
  }
}
```

#### `POST /api/solve/orient`

그래프와 solver type을 받아 방향 지정 결과를 반환한다.

요청 예시:

```json
{
  "solver": "robbin",
  "graph": {
    "nodes": [
      { "id": "3,4", "x": 3, "y": 4 }
    ],
    "edges": [
      { "id": "e1", "source": "3,4", "target": "4,4", "weight": 1.0 }
    ]
  },
  "options": {
    "max_iter": 1000,
    "patience": 100,
    "is_relaxed": false,
    "perturb_strength": 0.1
  }
}
```

응답 예시:

```json
{
  "solution": {
    "orientedEdges": [
      { "edgeId": "e1", "from": "3,4", "to": "4,4" }
    ],
    "score": {
      "apsp_sum": 123.0,
      "strong_connect_rate": 1.0,
      "flow_score": 0.82,
      "sample_score": 0.0
    }
  }
}
```

#### `POST /api/partition`

그래프 분할 결과를 반환한다.

요청 예시:

```json
{
  "strategy": "face-cluster",
  "graph": { }
}
```

응답 예시:

```json
{
  "partitions": [
    {
      "id": "p0",
      "nodeIds": ["1,1", "1,2"],
      "edgeIds": ["e1", "e2"]
    }
  ],
  "boundaryEdges": ["e3", "e4"]
}
```

#### `POST /api/simulate/step`

초기에는 mock으로 구현해도 된다. agent들의 위치를 oriented edge 방향에 따라 한 step 이동시킨다.

요청 예시:

```json
{
  "agents": [
    { "id": "a1", "x": 4.2, "y": 3.1, "target": "exit-right" }
  ],
  "orientedEdges": [
    { "edgeId": "e1", "from": "3,4", "to": "4,4" }
  ],
  "dt": 0.1
}
```

응답 예시:

```json
{
  "agents": [
    { "id": "a1", "x": 4.3, "y": 3.1, "vx": 1.0, "vy": 0.0 }
  ],
  "densityMap": [[0.0, 0.2, 0.5]]
}
```

---

## 5. Backend solver mapping

`solver_service.py`에서 문자열 solver type을 기존 factory에 매핑한다.

```python
SOLVER_FACTORIES = {
    "robbin": create_robbin_solver,
    "ils": create_ils_solver,
    "sa": create_sa_solver,
    "qubo": create_qubo_solver,
    "qubo_sa": create_qubo_sa_solver,
    "qubo_qa": create_qubo_qa_solver,
    "dnc_sa": create_dnc_sa_solver,
    "dnc_qubo": create_dnc_qubo_solver,
    "dnc_qubo_sa": create_dnc_qubo_sa_solver,
    "dnc_qubo_qa": create_dnc_qubo_qa_solver,
}
```

처음 MVP에서는 `robbin`, `ils`, `sa`부터 붙이고, QUBO/DnC 계열은 그 다음에 붙인다.

---

## 6. SampleScoreRanker 등록 이슈

다음 파일이 존재하는지 확인한다.

```text
mr2s_module/evaluator/sample_score_ranker.py
```

존재한다면 다음 export가 필요하다.

```python
# mr2s_module/evaluator/__init__.py
from .sample_score_ranker import SampleScoreRanker
```

`SampleScoreRanker().run(solution) -> float`는 항상 `0.0`을 반환한다. 목적은 SA/QA 샘플 중 최저 에너지를 그대로 채택하기 위한 ranker로 보인다.

이 파일이 git에 추가되지 않았으면 반드시 add한다.

```bash
git add mr2s_module/evaluator/sample_score_ranker.py
git add mr2s_module/evaluator/__init__.py
```

---

## 7. Frontend 구조

권장 구조:

```text
frontend/
  src/
    App.tsx
    main.tsx
    api/
      client.ts
      types.ts
    components/
      TopViewCanvas.tsx
      ControlPanel.tsx
      SolverPanel.tsx
      DensityLegend.tsx
      ScorePanel.tsx
      GraphOverlayToggle.tsx
    simulation/
      presets.ts
      density.ts
      agents.ts
      graph.ts
    styles/
      app.css
```

---

## 8. TypeScript 타입

`src/api/types.ts`에 다음 타입을 둔다.

```ts
export type NodeId = string;
export type EdgeId = string;

export interface GraphNode {
  id: NodeId;
  x: number;
  y: number;
}

export interface GraphEdge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  weight?: number;
}

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface OrientedEdge {
  edgeId: EdgeId;
  from: NodeId;
  to: NodeId;
}

export interface ScorePayload {
  apsp_sum?: number | null;
  strong_connect_rate?: number | null;
  flow_score?: number | null;
  sample_score?: number | null;
}

export interface SolutionPayload {
  orientedEdges: OrientedEdge[];
  score?: ScorePayload;
}

export interface Agent {
  id: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  target?: string;
}

export interface Cell {
  x: number;
  y: number;
  blocked: boolean;
  density: number;
}

export type DensityPreset = "low" | "intermediate" | "critical";

export type SolverType =
  | "robbin"
  | "ils"
  | "sa"
  | "qubo"
  | "qubo_sa"
  | "qubo_qa"
  | "dnc_sa"
  | "dnc_qubo"
  | "dnc_qubo_sa"
  | "dnc_qubo_qa";
```

---

## 9. React 화면 구성

### 9.1 `App.tsx`

역할:

- density preset state 관리
- graph state 관리
- agents state 관리
- orientedEdges state 관리
- solver 실행 버튼 처리
- play/pause/reset 처리

화면 배치:

```text
+--------------------------------------------------+
| Header: MR2S Crowd Orientation Top View          |
+----------------------+---------------------------+
| ControlPanel         | TopViewCanvas             |
| - density preset     | - grid                    |
| - solver select      | - agents                  |
| - run solver         | - density heatmap         |
| - play/pause         | - oriented edge arrows    |
| - overlay toggle     |                           |
|                      |                           |
| ScorePanel           |                           |
+----------------------+---------------------------+
```

### 9.2 `TopViewCanvas.tsx`

MVP에서는 HTML Canvas를 권장한다. 사람 수가 많아질 수 있기 때문에 SVG보다 Canvas가 유리하다.

렌더링 순서:

1. background
2. grid cells
3. density heatmap
4. graph edges
5. oriented edge arrows
6. agents
7. selected/hovered cell highlight

### 9.3 색상 규칙

초기값은 다음처럼 둔다.

```ts
function getDensityColor(density: number): string {
  if (density < 0.2) return "#7f8b45";      // low: green
  if (density < 0.6) return "#8a7a3a";      // medium: yellow/brown
  if (density < 0.85) return "#8a5a3a";     // high: brown
  return "#9a4b4b";                         // critical: red-brown
}
```

단, 프로젝트 스타일에 따라 색상은 자유롭게 조정 가능하다.

---

## 10. 시각화 preset

### 10.1 Low Density

- agent 수: 10~20명
- density 값: 대부분 0.0~0.25
- 사람들은 드문드문 배치
- 혼잡 구간은 거의 없음

### 10.2 Intermediate Density

- agent 수: 70~120명
- density 값: 중앙 통로에서 0.3~0.7
- 일부 병목 구간이 생김
- edge 방향 제어 결과가 눈에 보이기 시작해야 함

### 10.3 Critical High Density

- agent 수: 180~300명
- density 값: 중앙 통로에서 0.8 이상
- 붉은색/갈색 영역이 넓게 나타남
- 방향 제어 전후 비교가 가능해야 함

---

## 11. Graph 생성 방식

MVP에서는 grid graph를 사용한다.

- 통행 가능한 cell 하나를 node 하나로 본다.
- 상하좌우 인접 cell을 edge로 연결한다.
- blocked cell은 node를 만들지 않는다.
- edge weight는 기본 1.0
- density가 높은 cell을 지나가는 edge는 weight를 증가시킬 수 있다.

예시:

```ts
edge.weight = 1.0 + densityPenalty * averageDensity(sourceCell, targetCell)
```

이렇게 하면 혼잡 구간의 비용이 커지고, solver 결과가 우회 방향을 선호할 수 있다.

---

## 12. Agent 이동 방식

초기 MVP에서는 정교한 social force model을 만들지 말고 다음 방식으로 충분하다.

1. agent가 현재 위치한 cell을 찾는다.
2. 해당 cell node에서 나가는 oriented edge 후보를 찾는다.
3. 후보 중 목적지와 가까운 방향 또는 density가 낮은 방향을 선택한다.
4. 그 방향으로 작은 속도로 이동한다.
5. cell별 agent 수를 다시 세어 densityMap을 갱신한다.

이후 확장 시 다음 요소를 추가한다.

- collision avoidance
- local repulsion
- velocity smoothing
- exit attraction
- blocked area avoidance
- Fast Sweeping Method 기반 cost field

---

## 13. MR2S 결과를 어떻게 화면에 보여줄지

### 13.1 간선 방향 화살표

`orientedEdges` 결과를 받아 각 edge의 중앙에 화살표를 그린다.

```text
node A ----> node B
```

### 13.2 강연결성 점수

`score.strong_connect_rate`를 0~1 범위로 보여준다.

```text
Strong Connect Rate: 0.93
```

### 13.3 APSP 합

`score.apsp_sum`은 낮을수록 좋은 값으로 표시한다.

```text
APSP Sum: 1234.5
```

강연결이 아니면 `inf`가 나올 수 있으므로 UI에서는 다음처럼 표시한다.

```ts
Number.isFinite(score.apsp_sum) ? score.apsp_sum.toFixed(2) : "∞"
```

### 13.4 Partition overlay

DnC solver를 사용할 경우 partition 결과를 cell 또는 edge 색으로 구분한다.

---

## 14. 구현 순서

### Step 1. Repo 구조 파악

Claude는 먼저 현재 repo 구조를 확인한다.

```bash
find . -maxdepth 3 -type f | sort | head -200
```

확인할 것:

- `mr2s_module` 위치
- `frontend`가 이미 있는지
- `backend`가 이미 있는지
- package manager가 npm/pnpm/yarn 중 무엇인지
- Python 실행 환경

### Step 2. `SampleScoreRanker` export 확인

```bash
ls mr2s_module/evaluator
cat mr2s_module/evaluator/__init__.py
```

필요하면 다음을 추가한다.

```python
from .sample_score_ranker import SampleScoreRanker
```

### Step 3. Backend wrapper 작성

FastAPI 기준으로 다음 파일을 만든다.

```text
backend/app.py
backend/schemas.py
backend/graph_builder.py
backend/solver_service.py
```

먼저 `robbin` solver만 붙이고 동작 확인한다.

### Step 4. Frontend 생성

Vite React TypeScript 사용.

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
```

필요 라이브러리:

```bash
npm install axios
```

Canvas 직접 구현으로 시작한다. 처음부터 three.js, pixi.js, d3.js에 의존하지 않는다.

### Step 5. Mock data로 화면 완성

Backend 붙이기 전에 mock graph, mock orientedEdges, mock agents로 화면이 보이게 한다.

### Step 6. Backend API 연결

`src/api/client.ts`에서 API 호출 함수를 만든다.

```ts
export async function solveOrientation(payload: SolveRequest): Promise<SolveResponse> {
  const res = await fetch(`${API_BASE_URL}/api/solve/orient`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`solve failed: ${res.status}`);
  return res.json();
}
```

### Step 7. Solver 결과를 canvas에 반영

`Run Solver` 버튼을 누르면:

1. 현재 grid를 graph payload로 변환
2. `/api/solve/orient` 호출
3. `orientedEdges` 저장
4. canvas에서 화살표 표시
5. `ScorePanel` 업데이트

### Step 8. Play/Pause simulation 추가

`requestAnimationFrame` 또는 `setInterval`로 agent 위치를 업데이트한다.

MVP에서는 frontend에서 agent 이동을 처리해도 된다. 단, MR2S solver 로직은 backend에서만 실행한다.

---

## 15. 개발 시 주의할 점

1. `Robbin.run(graph)`는 강한 방향 지정이 가능한 그래프를 전제로 한다. bridge가 있는 그래프는 실패하거나 강연결이 불가능할 수 있다.
2. grid graph에 막힌 cell이 많으면 bridge가 생길 수 있다. 이 경우 UI에 경고를 표시한다.
3. `ApspSumRanker`는 강연결이 아니면 `inf`를 반환할 수 있다.
4. QUBO 계열은 의존성이 무거울 수 있으므로 MVP에서는 나중에 붙인다.
5. D-Wave나 quantum annealing 관련 dependency가 없으면 `qubo_qa`는 비활성화한다.
6. multiprocessing이 들어간 DnC solver는 FastAPI에서 바로 돌릴 때 이슈가 있을 수 있으므로 별도 옵션으로 둔다.
7. 브라우저에서 너무 많은 agent를 DOM element로 만들지 않는다. Canvas에 그린다.

---

## 16. MVP 완료 조건

다음이 되면 1차 완료로 본다.

- React 화면에 긴 통로형 grid가 보인다.
- Low / Intermediate / Critical preset이 바뀐다.
- preset에 따라 agent 수와 density color가 달라진다.
- `Run Solver` 버튼을 누르면 backend가 `mr2s_module` solver를 실행한다.
- 반환된 oriented edge가 canvas에 화살표로 표시된다.
- score가 UI에 표시된다.
- play 버튼을 누르면 agent들이 edge 방향을 따라 조금씩 움직인다.
- graph overlay를 on/off 할 수 있다.

---

## 17. 이후 확장 계획

MVP 이후에는 다음을 추가한다.

1. 방향 제어 전/후 비교 모드
   - before: 양방향 또는 기본 이동
   - after: MR2S oriented edge 적용
2. 위험도 지표
   - 평균 밀도
   - 최대 밀도
   - critical cell 개수
   - 병목 구간 지속 시간
3. Fast Sweeping Method 기반 목적지 cost field
   - 출구 비용 0
   - 혼잡 구간 비용 증가
   - `-∇φ` 방향으로 agent 이동
4. Unity simulation 연동 가능성
   - React는 실험 결과 viewer
   - Unity는 실제 3D crowd simulation
5. 연구 발표용 demo mode
   - 자동으로 low → intermediate → critical 상태를 순서대로 보여줌
   - solver 적용 전후를 split view로 비교

---

## 18. Claude에게 요청하는 실제 작업

아래 순서로 작업해라.

1. repo 구조를 먼저 확인해라.
2. `mr2s_module`의 실제 import path와 객체 생성 방식을 확인해라.
3. `SampleScoreRanker` export 누락 여부를 확인하고 필요하면 수정해라.
4. FastAPI backend wrapper를 만들어라.
5. React + TypeScript frontend를 만들어라.
6. mock data로 탑뷰 canvas를 먼저 완성해라.
7. backend API를 연결해 실제 solver 결과를 화살표로 표시해라.
8. README에 실행 방법을 적어라.
9. 가능하면 최소 테스트를 추가해라.

질문이 필요한 경우는 다음뿐이다.

- repo에 `mr2s_module`이 존재하지 않는 경우
- solver factory의 실제 함수 signature가 문서와 다른 경우
- Python dependency가 누락되어 실행 자체가 불가능한 경우

그 외에는 합리적인 가정으로 진행해라.

---

## 19. README에 포함할 실행 방법 예시

```bash
# backend
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

```bash
# frontend
cd frontend
npm install
npm run dev
```

브라우저에서 접속:

```text
http://localhost:5173
```

---

## 20. 최종 산출물

최종적으로 다음 파일/기능을 제공해야 한다.

```text
backend/app.py
backend/schemas.py
backend/graph_builder.py
backend/solver_service.py
backend/requirements.txt

frontend/src/App.tsx
frontend/src/api/client.ts
frontend/src/api/types.ts
frontend/src/components/TopViewCanvas.tsx
frontend/src/components/ControlPanel.tsx
frontend/src/components/SolverPanel.tsx
frontend/src/components/DensityLegend.tsx
frontend/src/components/ScorePanel.tsx
frontend/src/simulation/presets.ts
frontend/src/simulation/graph.ts
frontend/src/simulation/agents.ts
frontend/src/styles/app.css

README.md
```

---

## 21. 구현 퀄리티 기준

- TypeScript 타입 에러가 없어야 한다.
- React component가 너무 거대해지지 않게 분리한다.
- Canvas drawing 함수는 작게 나눈다.
- backend는 solver 실패 시 HTTP 400 또는 500과 명확한 error message를 반환한다.
- solver가 실패해도 frontend가 죽지 않고 error panel에 표시한다.
- simulation preset은 코드 상수로 관리한다.
- 나중에 Unity 또는 실제 실험 결과 데이터와 연결하기 쉬운 구조로 만든다.
