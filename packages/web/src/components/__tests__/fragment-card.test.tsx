import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FragmentCard } from '../fragment-card';

const fragment = {
  id: 'frag-001', type: 'introduction', domain: 'test', lang: 'fr',
  quality: 'approved' as const, author: 'test', title: 'Test Fragment',
  body_excerpt: 'This is a test excerpt', created_at: '2026-01-01',
  updated_at: '2026-01-01', uses: 0, file_path: 'test.md',
};

describe('FragmentCard', () => {
  it('renders fragment title', () => {
    render(<FragmentCard fragment={fragment} onClick={() => {}} />);
    expect(screen.getByText('Test Fragment')).toBeInTheDocument();
  });

  it('renders quality badge', () => {
    render(<FragmentCard fragment={fragment} onClick={() => {}} />);
    expect(screen.getByText('approved')).toBeInTheDocument();
  });

  it('renders type and lang badges', () => {
    render(<FragmentCard fragment={fragment} onClick={() => {}} />);
    expect(screen.getByText('introduction')).toBeInTheDocument();
    expect(screen.getByText('fr')).toBeInTheDocument();
  });

  it('renders domain badge', () => {
    render(<FragmentCard fragment={fragment} onClick={() => {}} />);
    expect(screen.getByText('test')).toBeInTheDocument();
  });

  it('renders body excerpt', () => {
    render(<FragmentCard fragment={fragment} onClick={() => {}} />);
    expect(screen.getByText('This is a test excerpt')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<FragmentCard fragment={fragment} onClick={onClick} />);
    fireEvent.click(screen.getByText('Test Fragment'));
    expect(onClick).toHaveBeenCalled();
  });

  it('renders "Sans titre" when title is null', () => {
    render(<FragmentCard fragment={{ ...fragment, title: null }} onClick={() => {}} />);
    expect(screen.getByText('Sans titre')).toBeInTheDocument();
  });
});
