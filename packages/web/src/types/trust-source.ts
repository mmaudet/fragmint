export type TrustSource = 'human-direct' | 'llm-confirmed' | 'llm-deviation' | 'llm-inferred';

export interface UploadHints {
  domain?: string;
  tags?: string[];
}
