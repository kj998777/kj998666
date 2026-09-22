// 손으로 작성한 최소 타입 정의 (supabase/migrations/0001_init.sql 과 맞춰서 관리).
// 나중에 Supabase CLI가 설치 가능해지면 `supabase gen types typescript` 로 자동 생성본으로
// 교체해도 되지만, 그 전까지는 이 파일이 스키마와 어긋나지 않도록 마이그레이션을 고칠 때 같이 고칠 것.

export type Role = "admin" | "editor" | "viewer";
export type ExamStatus = "열림" | "닫힘";
export type AnswerType = "객관식" | "주관식";
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
        };
        Insert: { code: string; name: string; status?: ExamStatus; created_by?: string | null };
        Update: { name?: string; status?: ExamStatus };
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
