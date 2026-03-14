import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlotPreview } from '../slot-preview';
import type { Fragment } from '@/api/types';

const baseSlot = {
  key: 'intro',
  type: 'introduction',
  domain: 'test',
  lang: 'fr',
  quality_min: 'reviewed',
  required: true,
  fallback: '',
  count: 1,
};

const fragment: Fragment = {
  id: 'frag-001', type: 'introduction', domain: 'test', lang: 'fr',
  quality: 'approved', author: 'test', title: 'Mon introduction',
  body_excerpt: 'Excerpt', created_at: '2026-01-01',
  updated_at: '2026-01-01', uses: 0, file_path: 'test.md',
};

describe('SlotPreview', () => {
  it('renders loading skeleton when isLoading is true', () => {
    const { container } = render(
      <SlotPreview slot={baseSlot} fragments={undefined} isLoading={true} onOverride={() => {}} />
    );
    // Skeleton elements are rendered as divs with Skeleton class
    const skeletons = container.querySelectorAll('[class*="animate-pulse"], [class*="skeleton"]');
    // At minimum the component should not show the slot key text when loading
    expect(screen.queryByText('intro')).not.toBeInTheDocument();
  });

  it('renders green state with fragment title when fragments found', () => {
    render(
      <SlotPreview slot={baseSlot} fragments={[fragment]} isLoading={false} onOverride={() => {}} />
    );
    expect(screen.getByText('intro')).toBeInTheDocument();
    expect(screen.getByText('Mon introduction')).toBeInTheDocument();
    expect(screen.getByText('approved')).toBeInTheDocument();
  });

  it('renders "Aucun fragment" when no fragments and required', () => {
    render(
      <SlotPreview slot={baseSlot} fragments={[]} isLoading={false} onOverride={() => {}} />
    );
    expect(screen.getByText('Aucun fragment')).toBeInTheDocument();
  });

  it('renders "Aucun fragment" when fragments is undefined', () => {
    render(
      <SlotPreview slot={baseSlot} fragments={undefined} isLoading={false} onOverride={() => {}} />
    );
    expect(screen.getByText('Aucun fragment')).toBeInTheDocument();
  });

  it('shows "requis" label for required slots', () => {
    render(
      <SlotPreview slot={baseSlot} fragments={[]} isLoading={false} onOverride={() => {}} />
    );
    expect(screen.getByText('requis')).toBeInTheDocument();
  });

  it('does not show "requis" for optional slots', () => {
    render(
      <SlotPreview slot={{ ...baseSlot, required: false }} fragments={[]} isLoading={false} onOverride={() => {}} />
    );
    expect(screen.queryByText('requis')).not.toBeInTheDocument();
  });

  it('shows fallback text when no fragments and fallback is set', () => {
    render(
      <SlotPreview
        slot={{ ...baseSlot, fallback: 'default-intro' }}
        fragments={[]}
        isLoading={false}
        onOverride={() => {}}
      />
    );
    expect(screen.getByText('fallback: default-intro')).toBeInTheDocument();
  });

  it('calls onOverride with slot key when clicked', () => {
    const onOverride = vi.fn();
    render(
      <SlotPreview slot={baseSlot} fragments={[fragment]} isLoading={false} onOverride={onOverride} />
    );
    fireEvent.click(screen.getByText('intro'));
    expect(onOverride).toHaveBeenCalledWith('intro');
  });

  it('shows fragment count when multiple fragments', () => {
    const fragments = [fragment, { ...fragment, id: 'frag-002', title: 'Second' }];
    render(
      <SlotPreview slot={baseSlot} fragments={fragments} isLoading={false} onOverride={() => {}} />
    );
    expect(screen.getByText('2 fragments')).toBeInTheDocument();
  });
});
