import { Search } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes } from 'react';

interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  compact?: boolean;
}

const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ compact, className, ...props }, ref) => {
    return (
      <div className={`rounded-lg bg-bg border border-divider px-3.5 gap-2 flex items-center ${compact ? 'py-2' : 'py-2.5'} ${className ?? ''}`}>
        <Search className="size-4 text-text-tertiary shrink-0" />
        <input
          ref={ref}
          type="text"
          className="text-sm text-text-primary bg-transparent flex-1 outline-none border-none p-0 placeholder:text-text-tertiary"
          {...props}
        />
      </div>
    );
  }
);

SearchInput.displayName = 'SearchInput';
export default SearchInput;
