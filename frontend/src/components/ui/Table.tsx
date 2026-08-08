import { cn } from '@/lib/utils';
import { type HTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from 'react';

interface TableProps extends HTMLAttributes<HTMLTableElement> {
  head?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Glass table: sticky mono uppercase header, hover rows, right-aligned
 * numeric columns (use `numeric` on th/td). JetBrains Mono numerals.
 */
export function Table({ head, children, className, ...props }: TableProps) {
  return (
    <div className="table-container">
      <table className={cn('table', className)} {...props}>
        {head && <thead>{head}</thead>}
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ className, children, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cn('num', className)} {...props}>
      {children}
    </th>
  );
}

export function Td({ className, children, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn(className)} {...props}>
      {children}
    </td>
  );
}
