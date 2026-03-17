import { Link, type LinkProps } from 'react-router-dom';
import type { ReactNode } from 'react';
import { baseClasses, variantClasses, sizeClasses, type ButtonVariant, type ButtonSize } from './Button';

interface LinkButtonProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  icon?: ReactNode;
}

export default function LinkButton({ variant = 'primary', size = 'md', fullWidth, icon, className, children, ...props }: LinkButtonProps) {
  return (
    <Link
      className={`
        ${baseClasses}
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${fullWidth ? 'w-full' : ''}
        ${className ?? ''}
      `.trim()}
      {...props}
    >
      {icon && icon}
      {children}
    </Link>
  );
}
