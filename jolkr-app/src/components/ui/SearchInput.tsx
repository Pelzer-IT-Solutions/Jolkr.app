import { Search } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes } from 'react';

interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  compact?: boolean;
}

const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ compact, className, ...props }, ref) => {
    return (
      <div className="relative rounded-lg ring-1 ring-transparent focus-within:ring-border-accent transition-shadow">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary size-4" />
        <input
          ref={ref}
          type="text"
          className={`
            w-full bg-panel text-text-primary text-sm rounded-lg
            pl-9 pr-3 placeholder:text-text-tertiary
            focus:outline-none
            ${compact ? 'py-2' : 'py-2.5'}
            ${className ?? ''}
          `.trim()}
          {...props}
        />
      </div>
    );
  }
);

SearchInput.displayName = 'SearchInput';
export default SearchInput;
