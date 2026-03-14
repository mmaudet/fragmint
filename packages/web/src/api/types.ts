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
  context_schema?: Record<string, { type: string; required?: boolean; default?: any; enum?: string[] }>;
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
