export type TrustSource = 'human-direct' | 'llm-confirmed' | 'llm-deviation' | 'llm-inferred';

export interface UploadHints {
  domain?: string;
  function_type?: string;
  audience?: string[];
  maturity?: string;
  tags?: string[];
  entities?: string[];
}
