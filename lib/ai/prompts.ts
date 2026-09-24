// AI 프롬프트·tool 스키마. Apps Script Code.gs의 EXTRACT_TOOL/EXTRACT_PROMPT/SOLVE_TOOL/
// solvePrompt_/DG_TOOL/dgPrompt_ 를 그대로 옮김(문구 하나도 바꾸지 않음 — 실전에서 검증된 프롬프트).

export type QuestionMeta = {
  label: string;
  type: "mc" | "short";
  points: number | null;
  page: number;
  area: string;
  unit: string;
  stem: string;
  fig: boolean;
  pa: string; // printed_answer
};

export const EXTRACT_TOOL = {
  name: "register_exam",
  description: "시험지의 문항 목록과 영역·배점 정보를 제출한다.",
  input_schema: {
    type: "object",
    properties: {
      exam_title: { type: "string" },
      areas: {
        type: "array",
        items: { type: "string" },
        description: "이 시험 범위의 큰 단원 영역 이름 3~7개",
      },
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            type: { type: "string", enum: ["mc", "short"] },
            points: { type: ["number", "null"] },
            page: { type: "integer" },
            area: { type: "string" },
            unit: { type: "string" },
            stem_start: { type: "string" },
            has_figure: { type: "boolean" },
            printed_answer: { type: ["string", "null"] },
          },
          required: ["label", "type", "area", "stem_start"],
        },
      },
      notes: { type: "array", items: { type: "string" } },
      total_count: {
        type: "integer",
        description:
          "시험지에 인쇄된 큰 문항의 총 개수(객관식과 서답형·서술형·단답형 전부, (1)(2) 소문항은 나누지 않고 1개로 셈)",
      },
    },
    required: ["areas", "questions"],
  },
} as const;

export const EXTRACT_PROMPT = [
  '첨부한 PDF는 한국 고등학교 수학 시험지입니다. 모든 쪽(그림·표·<보기>·조건 상자 포함)을 빠짐없이 살펴보고, 채점 앱에 등록할 문항 목록을 register_exam 도구로 제출하세요. 글로 답하지 말고 도구만 호출하세요.',
  "",
  "규칙",
  '0) 서답형을 빠뜨리지 마세요. 이 시험에는 객관식 뒤에(또는 따로 한 쪽에) 서답형·서술형·단답형·주관식·논술형 문항이 있는 경우가 많습니다. 선택지가 없이 답이나 풀이를 직접 쓰는 문항("구하시오"·"서술하시오"·"풀이 과정을 쓰시오", 소문항 (1)(2)가 있는 문항, "서1"·"서답형 1"·"[서술형 3]" 표시가 붙은 문항)도 객관식과 똑같이 하나도 빠짐없이 등록하세요. 배점 표기가 없거나, 답을 쓸 빈 공간만 길게 있거나, 마지막 쪽·별도의 쪽에 있어도 마찬가지입니다. 문제가 인쇄된 쪽만 문항으로 셉니다(정답표·해설·OMR 답안지 쪽의 번호는 새 문항이 아닙니다). 제출하기 전에 마지막 문제 쪽까지 다시 훑어 빠진 문항이 없는지 확인하세요.',
  '1) label: 문항 번호(공백·"번"·"."·대괄호는 뺍니다).',
  "   · 객관식·단답형이 1, 2, 3 … 으로 이어지면 숫자만 적습니다.",
  '   · 서답형(서술형·단답형 등)이 앞 문항에 이어 21, 22 처럼 연속 번호로 인쇄되어 있으면 그 숫자만 적습니다. 큰 숫자 번호(예 19) 옆에 "서2"·"서술형" 같은 작은 표시가 덧붙어 있어도 큰 숫자(19)를 label 로 씁니다.',
  '   · 서답형이 객관식과 따로 1번부터 다시 매겨져 있으면(예 "서답형 1", "서술형 2", "단답형 1", "주관식 3", 약칭 "서1") 인쇄된 이름과 번호를 붙여 서답형1, 서술형2, 단답형1 처럼 적습니다(약칭 "서1"은 서술형1). 객관식 번호와 같은 숫자만 쓰면 안 됩니다. label 은 한 시험 안에서 서로 달라야 합니다.',
  "   · 한 문항 안에 (1)(2) 또는 1) 2) 소문항이 있고 소문항마다 구하는 값(답란)이 따로 있으면 27-(1), 27-(2) (서답형1-(1), 서답형1-(2)) 처럼 소문항마다 별도 항목으로 적습니다(학생이 답란마다 입력합니다). 소문항이 없고 답이 하나면 문항 하나로 적습니다.",
  "   · 시험지에 나온 순서대로 적으세요.",
  "2) type: 선택지 ①~⑤ 중에서 고르는 문항은 mc, 그 밖의 문항(단답형·서술형·서답형)은 short.",
  "3) points: 시험지에 인쇄된 배점(숫자). 소문항마다 배점이 적혀 있으면 각각. 문항 전체 배점만 적혀 있고 소문항별 배점이 없으면 소문항 수로 나누어(나누어떨어지지 않으면 null). 배점 표기가 없으면 null. 임의로 추측하지 마세요.",
  "4) area: 문항이 속한 큰 단원 영역. 먼저 이 시험 범위 전체를 대표하는 영역 이름 3~7개를 areas 에 정한 뒤(예: 직선·점의 좌표 / 도형의 이동·대칭 / 원의 방정식 / 집합), 각 문항의 area 는 그 목록 중 하나를 그대로 쓰세요. unit: 더 세부적인 단원명(예: 두 점 사이의 거리).",
  "5) stem_start: 문제글의 첫 부분 40자 안팎(어떤 문항인지 구분할 수 있게). page: 문항이 있는 쪽 번호(1부터). has_figure: 그림·그래프·표가 문제에 포함되면 true.",
  "6) printed_answer: 시험지에 정답표나 빠른정답이 인쇄되어 있으면 그 문항의 정답(객관식은 1~5 숫자, 그 외는 값), 없으면 null.",
  "7) notes: 시험지의 오탈자, 잘려 보이거나 해석이 애매한 문제, 배점 표기 이상 등 선생님이 알아야 할 것(없으면 빈 배열).",
  "8) exam_title: 시험지에 적힌 시험 이름(참고용).",
  '9) total_count: 시험지에 인쇄된 큰 문항의 총 개수를 직접 세어 적으세요(객관식과 서답형·서술형·단답형 전부, (1)(2) 소문항은 나누지 않고 1개). 표지에 "총 N문항"이 적혀 있으면 그것과 맞는지 확인하세요. questions 에 적은 문항을 소문항끼리 묶었을 때의 개수와 같아야 합니다.',
].join("\n");

export const SOLVE_TOOL = {
  name: "submit_solution",
  description: "한 문항의 정답과 해설을 제출한다.",
  input_schema: {
    type: "object",
    properties: {
      label: { type: "string" },
      answer: { type: "string", description: "채점용 정답. 객관식은 1~5 중 숫자 한 글자" },
      answer_display: { type: "string", description: "객관식은 ② (4√5) 형태, 그 외는 값" },
      unit: { type: "string" },
      difficulty: { type: "string", enum: ["하", "중하", "중", "중상", "상"] },
      difficulty_reason: { type: "string" },
      statement: { type: "string", description: "문제 요약 서술" },
      solution: { type: "string", description: "핵심 단계 위주 풀이" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      notes: { type: "array", items: { type: "string" } },
      exam_fix: {
        type: "object",
        description:
          "시험지 자체의 명백한 오류·선지 누락이 있을 때만. issue·fix 는 학생에게 보이는 정오표라 정답·풀이를 절대 쓰지 않는다",
        properties: {
          issue: { type: "string" },
          fix: { type: "string" },
          teacher_note: { type: "string", description: "선생님만 볼 참고(정답·풀이 관련 내용은 여기에만)" },
        },
      },
    },
    required: [
      "label",
      "answer",
      "answer_display",
      "difficulty",
      "difficulty_reason",
      "statement",
      "solution",
      "confidence",
    ],
  },
} as const;

export function qName(label: string): string {
  return /^\d/.test(label) ? label + "번" : label + " (시험지에서 서답형·서술형·단답형 등으로 따로 번호가 매겨진 문항)";
}

export function solvePrompt(q: QuestionMeta, again?: boolean): string {
  const typ = q.type === "mc" ? "객관식" : "단답·서술형";
  const lines = [
    '첨부한 PDF는 한국 고등학교 수학 시험지입니다. 그중 "' +
      qName(q.label) +
      '" 문항(' +
      typ +
      (q.page ? ", " + q.page + "쪽" : "") +
      (q.stem ? ', 문제 시작: "' + q.stem + '"' : "") +
      ")만 풀어서 submit_solution 도구로 제출하세요. 글로 답하지 말고 도구만 호출하세요. 그림·표·<보기>가 있으면 그림 기준으로 해석하세요.",
    "",
    "규칙",
    "- 끝까지 직접 풀고, 계산할 수 있는 부분은 다시 한 번 검산해서 정답을 확정하세요. 소문항(예 27-(1))이면 그 소문항 하나의 답만 씁니다.",
    "- answer(채점용 정답): 객관식이면 1~5 중 숫자 한 글자. 그 외는 최종 답만 공백 없이: 분수 3/4, 제곱 a^2, 루트 4√5, 순서쌍 (1,2), 부등식 x≥3. 답이 여러 표기로 인정될 때만 | 로 구분(예: a^2|a²).",
    '- answer_display: 객관식은 "② (4√5)" 형태(선택지 번호 원문자 + 그 선택지의 값, 수식은 $...$), 그 외는 값(수식은 $...$).',
    "- unit: 세부 단원명(참고: " + (q.unit || "없음") + "). 영역(area)은 따로 적지 않습니다.",
    "- difficulty: 하 / 중하 / 중 / 중상 / 상 중 하나(직접 풀어 본 체감 난이도이며 실제 정답률이 아님). difficulty_reason: 한 줄 근거.",
    "- statement: 문제를 요약한 서술(수식 $...$). solution: 핵심 단계 위주 풀이.",
    "- 수식은 LaTeX 를 $...$ 로 감싸고 KaTeX 가 지원하는 명령만 쓰세요. 강조는 <b>…</b>, 줄바꿈은 <br>. 부등호는 반드시 \\lt, \\gt 로 쓰고 본문에 < > & 문자를 직접 쓰지 마세요.",
    "- 시험지에 정답표가 있어도 직접 푼 값을 answer 에 쓰고, 다르면 notes 에 그 사실을 적으세요.",
    again
      ? "- [다시 풀기] 이 문항은 앞선 풀이의 정답이 불확실해 다시 푸는 것입니다. 이전 풀이와 답은 알려 주지 않습니다. 문제를 처음부터 다시 읽고(그림·표·<보기>·조건·소문항 번호를 특히 확인), 앞선 풀이와 다른 접근(식 세우기 대신 대입·역산·그림 확인 등)으로 독립적으로 풀어 정답을 확정하세요. 계산 실수와 조건 오독을 점검하고, 최종 답을 한 번 더 검산하세요."
      : null,
    '- exam_fix: 시험지 자체에 명백한 오류가 있을 때만 씁니다(선택지 누락·중복, 조건 모순·빠진 조건, 그림과 문장 불일치, 문제가 성립하지 않는 오탈자 등). issue = 무엇이 잘못됐는지 한두 문장, fix = 학생에게 알려 줄 정정 내용(어떻게 고쳐 읽으면 되는지, 누락된 선택지는 "④ 값"처럼 보충). 이 내용은 학생들이 정오표로 보고 그 문제를 직접 풀기 때문에, 정답·풀이·계산 결과·정답 선택지 번호·답을 짐작하게 하는 표현(예: "정답은 ③", "따라서 x=3", "고치면 답이 ⑤가 된다")은 issue·fix 어디에도 절대 쓰지 말고, 문제에 인쇄된 조건·선택지·그림 설명 자체를 바로잡는 내용만 쓰세요. 선생님만 알아야 할 답·풀이 관련 내용은 teacher_note 에 쓰세요(학생에게 보이지 않음). 수식 기호($)·HTML 없이 √ ² ① ≤ 같은 일반 문자로만 쓰세요. 풀이(answer, solution)는 정정한 문제 기준으로 하고, 확신이 없으면 exam_fix 를 쓰지 말고 notes 에만 적으세요. 오류가 없으면 exam_fix 를 생략하세요.',
    "- confidence: 풀이에 확신이 있으면 high, 애매하면 medium, 확신이 없거나 문제 해석이 불확실하면 low. notes: 시험지 오탈자·가정한 점·서술형 채점 안내 등 선생님이 알아야 할 것(없으면 빈 배열).",
  ];
  return lines.filter((t): t is string => t !== null).join("\n");
}

// ---- 디지털 시험지(스캔본 옮겨적기) ----

export const DG_TOOL = {
  name: "submit_page",
  description: "시험지 한 쪽에 인쇄된 내용을 글자·수식·그림 위치로 옮겨 제출한다.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["questions", "cover", "answer_sheet", "explanation", "blank", "other"] },
      title: { type: "string" },
      subtitle: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["question", "text"] },
            label: { type: "string" },
            points: { type: ["number", "null"] },
            stem: { type: "string" },
            box_title: { type: "string" },
            box_lines: { type: "array", items: { type: "string" } },
            choices: { type: "array", items: { type: "string" } },
            figures: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  x0: { type: "number" },
                  y0: { type: "number" },
                  x1: { type: "number" },
                  y1: { type: "number" },
                  where: { type: "string", enum: ["stem", "end"] },
                },
                required: ["x0", "y0", "x1", "y1"],
              },
            },
            unsure: { type: "string" },
          },
          required: ["type", "stem"],
        },
      },
    },
    required: ["kind", "items"],
  },
} as const;

// ---- 출제오류 의심 판단 (v37) ----

export const ERROR_CHECK_TOOL = {
  name: "submit_error_check",
  description: "한 문항을 직접 풀어 보고 출제오류(문제 자체의 결함)가 의심되는지 판단해 제출한다.",
  input_schema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["suspect", "ok"] },
      kind: {
        type: "string",
        enum: ["조건모순", "조건부족", "정답없음", "정답여러개", "선택지오류", "그림불일치", "문장불일치", "오탈자", "기타"],
        description: "verdict가 suspect일 때만. 아니면 빈 문자열.",
      },
      reason: { type: "string", description: "선생님용 판단 근거(직접 풀어 본 과정·왜 성립하지 않는지). 학생에게는 보이지 않음." },
      student_note: {
        type: "string",
        description: "학생에게 보여도 되는 한 줄(있다면). 정답·풀이·정답 번호·계산 결과를 절대 언급하지 않는다. 없으면 빈 문자열.",
      },
      answer: { type: "string", description: "직접 풀어서 나온 답(참고용, 채점에는 쓰지 않음)" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["verdict", "reason", "confidence"],
  },
} as const;

export function errorCheckPrompt(label: string, statement: string, existingSolution: string, hint: string): string {
  const lines = [
    '첨부한 PDF는 한국 고등학교 수학 시험지입니다. 그중 "' +
      qName(label) +
      '" 문항을 처음부터 끝까지 직접 다시 풀어 보고, 이 문제 자체에 출제오류(조건 모순·조건 부족·정답이 없음·정답이 여러 개·선택지 오류·그림과 문장 불일치·문제가 성립하지 않는 오탈자 등)가 있는지 판단해 submit_error_check 도구로 제출하세요. 글로 답하지 말고 도구만 호출하세요.',
    "",
    "참고(기존에 등록된 정보, 참고만 하고 반드시 직접 다시 확인할 것)",
    "- 문제 요약: " + (statement || "(없음)"),
    "- 기존 풀이(이미 잘못됐을 수 있음, 그대로 믿지 말 것): " + (existingSolution ? existingSolution.slice(0, 1500) : "(없음)"),
    "",
    "규칙",
    "- 계산 실수·문제를 잘못 읽은 것과 진짜 출제오류를 구분하세요. 몇 번을 다시 확인해도 문제 자체가 성립하지 않을 때만 verdict=suspect 로 판단하세요.",
    "- 시험지에 인쇄된 정답표와 직접 푼 답이 다르다는 이유만으로는 오류가 아닙니다(정답표 쪽이 틀렸을 수도 있습니다). 문제 자체의 결함(조건·선택지·그림·문장)이 있을 때만 suspect 로 표시하세요.",
    hint ? '- 선생님이 남긴 의심 단서(참고만 하고 직접 확인할 것): "' + hint.slice(0, 300) + '"' : null,
    "- student_note 는 학생용 정오표가 아니라 해설 화면에만 보이는 참고 문구입니다. 정답·풀이·계산 결과·정답 선택지 번호·답을 짐작하게 하는 표현은 절대 쓰지 마세요. 애매하면 빈 문자열로 두세요.",
    "- reason 은 선생님만 보는 내용이니 직접 풀어 본 과정과 왜 성립하지 않는다고 판단했는지를 구체적으로 쓰세요.",
    "- confidence: 판단에 확신이 있으면 high, 애매하면 medium/low.",
  ];
  return lines.filter((t): t is string => t !== null).join("\n");
}

export function dgPrompt(n: number, total: number): string {
  return [
    '첨부한 PDF는 스캔(그림)으로 된 한국 고등학교 수학 시험지입니다. 그중 "' +
      n +
      '쪽"(전체 ' +
      total +
      "쪽) 하나만 보고, 학생에게 나눠 줄 깔끔한 디지털 시험지를 새로 조판할 수 있도록 그 쪽에 인쇄된 내용을 글자·수식으로 옮겨 submit_page 도구로 제출하세요. 글로 답하지 말고 반드시 도구로 제출합니다.",
    "",
    "규칙",
    "- kind: 문제가 하나라도 있는 쪽이면 questions. 표지(시험명·이름 쓰는 칸만 있는 쪽)면 cover, 마킹(OMR) 답안지면 answer_sheet, 정답표·해설·풀이 쪽이면 explanation, 백지면 blank, 그 밖은 other. questions 가 아니면 items 는 빈 배열로 제출하세요.",
    "- 문제를 풀지 말고 인쇄된 그대로 옮기세요. 정답·풀이·해설·힌트·답을 짐작하게 하는 표현을 새로 쓰거나 덧붙이지 않습니다. 손으로 쓴 풀이·체크·낙서·형광펜 표시는 옮기지 않습니다(그것에 가려진 인쇄 글자는 문맥으로 읽되 확실하지 않으면 unsure 에 적으세요).",
    "- title/subtitle: 이 쪽 맨 위에 인쇄된 시험 제목(학년도·학기·고사명·과목)과 부제만. 없으면 빈 문자열. 쪽 번호·머리말·꼬리말·학교 로고·QR 코드·바코드는 옮기지 않습니다.",
    "- items: 이 쪽의 문항과 안내글을 읽는 순서대로(2단 편집이면 왼쪽 단 위→아래, 그다음 오른쪽 단). 큰 문항 하나(객관식·단답형·서술형 문항 하나)가 항목 하나입니다.",
    '  · type=question: label = 인쇄된 문항 번호(1, 2 … 처럼 "." 과 "번"은 뺌. 서답형·서술형·단답형 문항이 따로 번호가 매겨져 있으면 서답형 1, 서술형 2, 단답형 1 처럼 인쇄된 이름 그대로. 큰 숫자 옆에 "서2" 같은 작은 표시가 붙어 있으면 큰 숫자만). 서술형의 (1)(2) 소문항은 한 항목 안에 stem 의 줄로 함께 적습니다. points = 인쇄된 배점 숫자(없으면 null; "[3점]" 표기는 stem 에 넣지 않음). stem = 문제 본문 전체(선택지 제외).',
    '  · type=text: 문항이 아닌 안내글·구분 제목(예: "※ 다음 물음에 답하시오.", "[서술형]", "[서답형]"). label 은 빈 문자열, stem 에 글.',
    "- stem·box_lines·choices 의 수식은 LaTeX 를 $...$ 로 감싸고 KaTeX 가 지원하는 명령만 쓰세요(분수 \\frac, 루트 \\sqrt, 첨자, \\le \\ge \\lt \\gt, \\cdot, \\times, \\circ, \\angle, \\triangle, \\overrightarrow, \\begin{cases} 등). 글 속에 < > & 를 직접 쓰지 말고 \\lt \\gt 를 쓰세요. 줄바꿈은 \\n 으로 쓰되, 인쇄 때문에 줄이 바뀐 문장은 이어서 쓰고 (가)(나) 조건처럼 항목이 따로 줄에 인쇄된 것만 줄을 나눕니다.",
    '- box_title/box_lines: 문제 안에 테두리 상자로 인쇄된 <보기>·조건·[자료] 가 있으면 box_title(예 "<보기>")과 box_lines(한 줄에 한 항목, ㄱ. ㄴ. ㄷ. 도 그대로)에 옮기고 stem 에는 넣지 않습니다. 없으면 빈 문자열·빈 배열.',
    "- choices: 선택지 ①~⑤ 의 내용만 순서대로(원문자 기호는 빼기). 객관식이 아니면 빈 배열. 선택지가 그림이면 그 선택지는 \"(그림)\" 으로 적고 그림은 figures 에 넣습니다.",
    "- figures: 그림·그래프·도형·표처럼 글자와 수식으로 옮길 수 없는 것의 위치. 쪽 전체를 가로 1000 × 세로 1000 칸으로 나눴을 때 왼쪽 위가 (0,0), 오른쪽 아래가 (1000,1000): x0,y0 = 그림의 왼쪽 위, x1,y1 = 오른쪽 아래. 그림 안의 글자·눈금·점 이름·범례를 모두 포함하되 문제 글은 넣지 않도록 여유를 아주 조금만 두고 정확히 잡으세요. where: 문제 글 다음·선택지 앞에 놓인 그림은 \"stem\", 선택지 뒤에 놓인 그림은 \"end\". 그림 속 글자는 다시 적지 않습니다.",
    "- unsure: 글자가 흐리거나 잘려서 확실히 읽지 못한 부분이 있으면 무엇이 불확실한지 짧게(없으면 빈 문자열).",
  ].join("\n");
}
