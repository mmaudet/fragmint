import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QualityBadge } from '../quality-badge';

describe('QualityBadge', () => {
  it('renders approved badge', () => {
    render(<QualityBadge quality="approved" />);
    expect(screen.getByText('approved')).toBeInTheDocument();
  });

  it('renders reviewed badge', () => {
    render(<QualityBadge quality="reviewed" />);
    expect(screen.getByText('reviewed')).toBeInTheDocument();
  });

  it('renders draft badge', () => {
    render(<QualityBadge quality="draft" />);
    expect(screen.getByText('draft')).toBeInTheDocument();
  });

  it('renders deprecated badge', () => {
    render(<QualityBadge quality="deprecated" />);
    expect(screen.getByText('deprecated')).toBeInTheDocument();
  });
});
