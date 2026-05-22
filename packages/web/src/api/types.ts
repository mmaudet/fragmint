import type { UploadHints } from '@/types/trust-source';

export interface ApiResponse<T> {
  data: T | null;
  meta: { count?: number } | null;
  error: string | null;
}

export interface Fragment {
  id: string;
  type: string;
  domain: string;
  lang: string;
  quality: 'draft' | 'reviewed' | 'approved' | 'deprecated';
  author: string;
  title: string | null;
  body_excerpt: string | null;
  body?: string;
  created_at: string;
  updated_at: string;
  uses: number;
  file_path: string;
  tags?: string[];
  parent_id?: string | null;
  translation_of?: string | null;
  frontmatter?: Record<string, any>;
  valid_from?: string | null;
  valid_until?: string | null;
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  output_format: string;
  version: string;
  author: string;
  created_at: string;
  updated_at: string;
  fragments?: Array<{
    key: string;
    type: string;
    domain: string;
    lang: string;
    quality_min: string;
    required: boolean;
    fallback: string;
    count: number;
  }>;
  context_schema?: Record<
    string,
    { type: string; required?: boolean; default?: any; enum?: string[] }
  >;
}

export interface ComposeResponse {
  document_url: string;
  expires_at: string;
  template: { id: string; name: string; version: string };
  context: Record<string, any>;
  resolved: Array<{ key: string; fragment_id: string; score: number; quality: string }>;
  skipped: string[];
  generated: any[];
  structured_data?: Record<string, any>;
  warnings: string[];
  render_ms: number;
}

export interface User {
  login: string;
  role: string;
  display_name: string;
}

export interface AdminUser {
  id: string;
  login: string;
  display_name: string;
  role: string;
  active: number;
  created_at: string;
  last_login: string | null;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface InventoryResult {
  total: number;
  by_type: Record<string, number>;
  by_quality: Record<string, number>;
  by_lang: Record<string, Record<string, number>>;
  gaps: Array<{ type: string; domain: string; lang: string; status: string; source_id?: string }>;
}

export interface GitLogEntry {
  commit: string;
  author: string;
  date: string;
  message: string;
}

export interface HarvestJob {
  id: string;
  status: 'processing' | 'done' | 'error';
  files: string[];
  collection_slug: string | null;
  stats: { total: number; duplicates: number; low_confidence: number; valid: number } | null;
  error: string | null;
  created_at: string;
}

export interface CoherenceFlag {
  type: 'subject_coherence' | 'entity_coverage' | 'duplicate_check' | 'prototype_distance';
  level: 'ok' | 'warning' | 'error' | 'info';
  message: string;
}

export interface JudgeVerdict {
  verdict: 'pass' | 'partial' | 'fail';
  reason: string;
}

export interface JudgeResult {
  reusability: JudgeVerdict;
  semantic_coherence: JudgeVerdict;
  classification_accuracy: JudgeVerdict;
  overall_recommendation: 'accept' | 'review' | 'reject';
  overall_reason: string;
}

export interface HarvestCandidate {
  id: string;
  job_id: string;
  title: string;
  body: string;
  type: string;
  domain: string;
  lang: string;
  tags: string[];
  function_type: string | null;
  audience: string[];
  maturity: string | null;
  confidence: number;
  origin_source: string;
  origin_page: number | null;
  duplicate_of: string | null;
  duplicate_score: number | null;
  status: 'pending' | 'accepted' | 'rejected' | 'merged';
  fragment_id: string | null;
  trust_sources_json: string | null;
  quality_signals: CoherenceFlag[];
  judge_result: JudgeResult | null;
}

export interface HarvestJobWithCandidates extends HarvestJob {
  candidates: HarvestCandidate[];
  upload_hints?: UploadHints;
}

export interface ValidateResult {
  committed: number;
  merged: number;
  rejected: number;
}

export interface CollectionWithRole {
  id: string;
  slug: string;
  name: string;
  type: 'system' | 'team' | 'personal';
  role: string;
  read_only: boolean;
  description: string | null;
  tags?: string[];
}

export type PlanStatus = 'draft' | 'plan_validated' | 'fragments_validated' | 'completed';

export interface PlanFilters {
  domain?: string[];
  lang?: string;
  type?: string;
  tags?: string[];
}

export interface FragmentCandidate {
  fragment_id: string;
  score: number;
  title: string | null;
  body_excerpt: string | null;
  quality: string;
}

export interface SectionFragmentSelection {
  fragment_id: string;
  body: string;
  edited: boolean;
  propose_to_library: boolean;
  proposed_fragment_id?: string;
}

export interface PlanSection {
  id: string;
  title: string;
  description: string;
  candidates: FragmentCandidate[];
  selected: SectionFragmentSelection[];
  generated_markdown?: string;
  filters_override?: PlanFilters;
  inferred_type?: string;
  writer_instructions?: string;
}

export interface PlanState {
  spec_prompt: string;
  filters: PlanFilters;
  plan_markdown: string;
  writer_prompt_override?: string;
  sections: PlanSection[];
  draft_markdown?: string;
  draft_dirty?: boolean;
  export_style_template_id?: string;
}

export interface Plan {
  id: string;
  title: string;
  owner: string;
  collection_slug: string | null;
  status: PlanStatus;
  state: PlanState;
  created_at: string;
  updated_at: string;
}

export interface StyleTemplate {
  id: string;
  name: string;
  description: string | null;
  template_path: string;
  kind: 'composer' | 'style_reference';
  output_format: string;
  created_at: string;
  updated_at: string;
}
