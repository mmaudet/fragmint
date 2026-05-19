import { useState, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChipSelectProps {
  value: string[];
  onChange: (v: string[]) => void;
  suggestions: string[];
  placeholder?: string;
}

export function ChipSelect({ value, onChange, suggestions, placeholder }: ChipSelectProps) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = suggestions.filter(
    (s) => s.toLowerCase().includes(input.toLowerCase()) && !value.includes(s),
  );

  function add(s: string) {
    const trimmed = s.trim();
    if (trimmed && !value.includes(trimmed)) onChange([...value, trimmed]);
    setInput('');
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function remove(s: string) {
    onChange(value.filter((v) => v !== s));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && filtered[activeIndex]) {
        add(filtered[activeIndex]);
      } else if (input.trim()) {
        add(input);
      }
      return;
    }
    if (e.key === ',' && input.trim()) {
      e.preventDefault();
      add(input);
    }
    if (e.key === 'Backspace' && !input && value.length > 0) {
      onChange(value.slice(0, -1));
    }
    if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div className="relative">
      <div
        className="flex flex-wrap gap-1 min-h-9 px-3 py-1.5 rounded-md border border-input bg-background text-sm cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((v) => (
          <span key={v} className="flex items-center gap-1 bg-secondary text-secondary-foreground rounded px-2 py-0.5 text-xs">
            {v}
            <button type="button" onClick={(e) => { e.stopPropagation(); remove(v); }}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); setOpen(true); setActiveIndex(-1); }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={value.length === 0 ? placeholder : ''}
          className="flex-1 min-w-20 bg-transparent outline-none placeholder:text-muted-foreground"
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
          {filtered.map((s, i) => (
            <button
              key={s}
              type="button"
              className={cn('w-full text-left px-3 py-1.5 text-sm hover:bg-accent', i === activeIndex && 'bg-accent')}
              onMouseDown={(e) => { e.preventDefault(); add(s); }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
