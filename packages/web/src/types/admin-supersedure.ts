export interface FragmentSummary {
  id: string;
  title: string | null;
  body_excerpt: string | null;
  domain: string;
  type: string;
  lang: string;
  quality: string;
  created_at: string;
}

export interface SupersedureProposal {
  id: string;
  new_fragment_id: string;
  old_fragment_id: string;
  similarity_score: number;
  llm_judgment: string;
  llm_confidence: number;
  llm_reasoning: string | null;
  elements_lost_in_new: string | null;
  status: 'pending' | 'confirmed' | 'rejected' | 'coexist';
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  new_fragment?: FragmentSummary;
  old_fragment?: FragmentSummary;
}

export interface SupersedureStatsResponse {
  pending: number;
  confirmed: number;
  rejected: number;
  coexist: number;
  total: number;
}
