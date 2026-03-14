export interface CommitMessageParams {
  action: 'create' | 'update' | 'approve' | 'deprecate' | 'translate' | 'generate' | 'harvest';
  type: string;
  domain: string;
  description: string;
  author: string;
  fragmentId: string;
  qualityTransition?: string;
}

export function buildCommitMessage(params: CommitMessageParams): string {
  const lines = [
    `${params.action}(${params.type}/${params.domain}): ${params.description}`,
    '',
    `Author: ${params.author}`,
    `Fragment-Id: ${params.fragmentId}`,
  ];

  if (params.qualityTransition) {
    lines.push(`Quality-Transition: ${params.qualityTransition}`);
  }

  return lines.join('\n');
}
