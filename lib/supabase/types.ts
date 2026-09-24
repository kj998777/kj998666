// 손으로 작성한 최소 타입 정의 (supabase/migrations/0001_init.sql 과 맞춰서 관리).
// 나중에 Supabase CLI가 설치 가능해지면 `supabase gen types typescript` 로 자동 생성본으로
// 교체해도 되지만, 그 전까지는 이 파일이 스키마와 어긋나지 않도록 마이그레이션을 고칠 때 같이 고칠 것.

export type Role = "admin" | "editor" | "viewer";
export type ExamStatus = "열림" | "닫힘" | "검수대기";
export type AnswerType = "객관식" | "주관식";
export type Difficulty = "하" | "중하" | "중" | "중상" | "상";
export type ExamJobStage =
  | "upload"
  | "extract_submit"
  | "extract_wait"
  | "solve_submit"
  | "solve_wait"
  | "review"
  | "done"
  | "error";
export type DigitizeJobStage = "dg_upload" | "dg_submit" | "dg_wait" | "dg_done" | "dg_error";
export type ItemCheckStage = "rx_submit" | "rx_wait" | "rx_done" | "rx_error";
export type SchoolLevel = "초" | "중" | "고";
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; email: string; role: Role; created_at: string };
        Insert: { id: string; email: string; role?: Role };
        Update: { role?: Role };
        Relationships: [];
      };
      classes: {
        Row: {
          id: string;
          level: "초" | "중" | "고";
          grade: number;
          name: string;
          created_at: string;
        };
        Insert: { level: "초" | "중" | "고"; grade: number; name: string };
        Update: { level?: "초" | "중" | "고"; grade?: number; name?: string };
        Relationships: [];
      };
      exams: {
        Row: {
          id: string;
          code: string;
          name: string;
          status: ExamStatus;
          created_by: string | null;
          created_at: string;
          folder_year: string | null;
          folder_grade: number | null;
          folder_term: number | null;
          folder_kind: "중간" | "기말" | "기타" | null;
          school_level: SchoolLevel | null;
        };
        Insert: {
          code: string;
          name: string;
          status?: ExamStatus;
          created_by?: string | null;
          folder_year?: string | null;
          folder_grade?: number | null;
          folder_term?: number | null;
          folder_kind?: "중간" | "기말" | "기타" | null;
          school_level?: SchoolLevel | null;
        };
        Update: {
          name?: string;
          status?: ExamStatus;
          folder_year?: string | null;
          folder_grade?: number | null;
          folder_term?: number | null;
          folder_kind?: "중간" | "기말" | "기타" | null;
          school_level?: SchoolLevel | null;
        };
        Relationships: [];
      };
      answer_key: {
        Row: {
          id: string;
          exam_id: string;
          item_label: string;
          sort_order: number;
          correct_answers: string;
          points: number;
          type: AnswerType;
        };
        Insert: {
          exam_id: string;
          item_label: string;
          sort_order?: number;
          correct_answers: string;
          points: number;
          type: AnswerType;
        };
        Update: {
          item_label?: string;
          sort_order?: number;
          correct_answers?: string;
          points?: number;
          type?: AnswerType;
        };
        Relationships: [];
      };
      submissions: {
        Row: {
          id: string;
          exam_id: string;
          class_label: string;
          student_name: string;
          answers: unknown;
          submitted_at: string;
        };
        Insert: {
          exam_id: string;
          class_label: string;
          student_name: string;
          answers: unknown;
        };
        Update: never;
        Relationships: [];
      };
      grading_results: {
        Row: {
          id: string;
          submission_id: string;
          exam_id: string;
          per_item: unknown;
          total_score: number;
          graded_at: string;
        };
        Insert: {
          submission_id: string;
          exam_id: string;
          per_item: unknown;
          total_score: number;
        };
        Update: never;
        Relationships: [];
      };
      item_explanations: {
        Row: {
          id: string;
          exam_id: string;
          item_label: string;
          area: string;
          unit: string;
          difficulty: Difficulty;
          difficulty_reason: string;
          problem_statement: string;
          answer_display: string;
          solution: string;
          points_assigned: boolean;
          exam_error_suspected: boolean;
          exam_error_kind: string;
          exam_error_reason: string;
          exam_error_student_note: string;
          updated_at: string;
        };
        Insert: {
          exam_id: string;
          item_label: string;
          area?: string;
          unit?: string;
          difficulty?: Difficulty;
          difficulty_reason?: string;
          problem_statement?: string;
          answer_display?: string;
          solution?: string;
          points_assigned?: boolean;
          exam_error_suspected?: boolean;
          exam_error_kind?: string;
          exam_error_reason?: string;
          exam_error_student_note?: string;
        };
        Update: {
          area?: string;
          unit?: string;
          difficulty?: Difficulty;
          difficulty_reason?: string;
          problem_statement?: string;
          answer_display?: string;
          solution?: string;
          points_assigned?: boolean;
          exam_error_suspected?: boolean;
          exam_error_kind?: string;
          exam_error_reason?: string;
          exam_error_student_note?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      item_checks: {
        Row: {
          exam_id: string;
          item_label: string;
          stage: ItemCheckStage;
          message: string;
          state: Record<string, unknown>;
          updated_at: string;
        };
        Insert: {
          exam_id: string;
          item_label: string;
          stage: ItemCheckStage;
          message?: string;
          state?: Record<string, unknown>;
        };
        Update: { stage?: ItemCheckStage; message?: string; state?: Record<string, unknown> };
        Relationships: [];
      };
      exam_notes: {
        Row: { id: string; exam_id: string; sort_order: number; note: string; created_at: string };
        Insert: { exam_id: string; sort_order?: number; note: string };
        Update: never;
        Relationships: [];
      };
      exam_corrections: {
        Row: {
          id: string;
          exam_id: string;
          item_label: string;
          issue: string;
          fix: string;
          teacher_note: string;
          created_at: string;
        };
        Insert: {
          exam_id: string;
          item_label: string;
          issue?: string;
          fix?: string;
          teacher_note?: string;
        };
        Update: { issue?: string; fix?: string; teacher_note?: string };
        Relationships: [];
      };
      exam_pdf_meta: {
        Row: {
          exam_id: string;
          storage_path: string;
          pages: number | null;
          is_scanned: boolean | null;
          uploaded_at: string;
          uploaded_by: string | null;
        };
        Insert: {
          exam_id: string;
          storage_path: string;
          pages?: number | null;
          is_scanned?: boolean | null;
          uploaded_by?: string | null;
        };
        Update: { storage_path?: string; pages?: number | null; is_scanned?: boolean | null };
        Relationships: [];
      };
      exam_jobs: {
        Row: {
          exam_id: string;
          stage: ExamJobStage;
          message: string;
          state: Record<string, unknown>;
          updated_at: string;
        };
        Insert: {
          exam_id: string;
          stage: ExamJobStage;
          message?: string;
          state?: Record<string, unknown>;
        };
        Update: { stage?: ExamJobStage; message?: string; state?: Record<string, unknown> };
        Relationships: [];
      };
      digitize_jobs: {
        Row: {
          exam_id: string;
          stage: DigitizeJobStage;
          message: string;
          state: Record<string, unknown>;
          updated_at: string;
        };
        Insert: {
          exam_id: string;
          stage: DigitizeJobStage;
          message?: string;
          state?: Record<string, unknown>;
        };
        Update: { stage?: DigitizeJobStage; message?: string; state?: Record<string, unknown> };
        Relationships: [];
      };
      digitized_pages: {
        Row: { id: string; exam_id: string; page_no: number; data: Record<string, unknown> };
        Insert: { exam_id: string; page_no: number; data: Record<string, unknown> };
        Update: never;
        Relationships: [];
      };
      ai_settings: {
        Row: { id: true; model: string; api_key: string | null; updated_at: string };
        Insert: never;
        Update: { model?: string; api_key?: string | null };
        Relationships: [];
      };
      ai_usage: {
        Row: {
          id: true;
          spent_usd: number;
          tokens_in: number;
          tokens_out: number;
          since: string;
          balance_usd: number | null;
          balance_recorded_at: string | null;
          balance_spent_at_record: number | null;
          low_alert_at: string | null;
          low_alert_kind: "credit" | "limit" | null;
          low_alert_message: string | null;
        };
        Insert: never;
        Update: {
          spent_usd?: number;
          tokens_in?: number;
          tokens_out?: number;
          since?: string;
          balance_usd?: number | null;
          balance_recorded_at?: string | null;
          balance_spent_at_record?: number | null;
          low_alert_at?: string | null;
          low_alert_kind?: "credit" | "limit" | null;
          low_alert_message?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      submit_and_grade: {
        Args: {
          p_exam_code: string;
          p_class_label: string;
          p_student_name: string;
          p_answers: unknown;
          p_per_item: unknown;
          p_total_score: number;
        };
        Returns: string;
      };
      current_profile_role: { Args: Record<string, never>; Returns: string | null };
    };
  };
}
