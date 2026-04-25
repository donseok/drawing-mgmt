import * as React from 'react';
import {
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * FileTypeIcon — DESIGN §2.4, §7.
 * Picks a Lucide icon by file extension or MIME type.
 *
 * Supported (DESIGN.md / shared.constants.ALLOWED_FILE_EXTENSIONS):
 *   .dwg .dxf  → drafting (FileType2 + amber)
 *   .pdf       → FileText + rose
 *   .xlsx .xls → FileSpreadsheet + emerald
 *   .docx .doc → FileText + sky
 *   .png .jpg .jpeg .tif .tiff → FileImage + violet
 *   .zip       → FileArchive + slate
 *   .txt .md   → FileText + slate
 *   default    → File + fg-muted
 */
export interface FileTypeIconProps extends React.HTMLAttributes<SVGSVGElement> {
  /** Pass either a filename (with extension) or a mimeType. At least one is required. */
  filename?: string;
  mimeType?: string;
  /** Override size (Tailwind class). Default: h-4 w-4. */
  size?: 'sm' | 'default' | 'lg';
  /** Apply the type-specific tint color. Default: true. */
  tinted?: boolean;
}

interface IconSpec {
  Icon: LucideIcon;
  /** Tailwind class for tint color. */
  tint: string;
}

function detectExt(filename?: string): string | undefined {
  if (!filename) return undefined;
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m?.[1];
}

function specForExt(ext: string | undefined, mimeType?: string): IconSpec {
  // Resolve from extension first, MIME as fallback.
  switch (ext) {
    case 'dwg':
    case 'dxf':
      return { Icon: FileType2, tint: 'text-amber-600 dark:text-amber-400' };
    case 'pdf':
      return { Icon: FileText, tint: 'text-rose-600 dark:text-rose-400' };
    case 'xlsx':
    case 'xls':
    case 'csv':
      return { Icon: FileSpreadsheet, tint: 'text-emerald-600 dark:text-emerald-400' };
    case 'docx':
    case 'doc':
      return { Icon: FileText, tint: 'text-sky-600 dark:text-sky-400' };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'tif':
    case 'tiff':
      return { Icon: FileImage, tint: 'text-violet-600 dark:text-violet-400' };
    case 'zip':
    case 'tar':
    case 'gz':
    case '7z':
      return { Icon: FileArchive, tint: 'text-slate-600 dark:text-slate-400' };
    case 'txt':
    case 'md':
      return { Icon: FileText, tint: 'text-fg-muted' };
    default:
      break;
  }

  if (mimeType) {
    if (mimeType.startsWith('image/'))
      return { Icon: FileImage, tint: 'text-violet-600 dark:text-violet-400' };
    if (mimeType === 'application/pdf')
      return { Icon: FileText, tint: 'text-rose-600 dark:text-rose-400' };
    if (mimeType.includes('spreadsheet') || mimeType === 'text/csv')
      return { Icon: FileSpreadsheet, tint: 'text-emerald-600 dark:text-emerald-400' };
    if (mimeType.includes('word'))
      return { Icon: FileText, tint: 'text-sky-600 dark:text-sky-400' };
    if (mimeType === 'application/zip' || mimeType.includes('compressed'))
      return { Icon: FileArchive, tint: 'text-slate-600 dark:text-slate-400' };
  }

  return { Icon: File, tint: 'text-fg-muted' };
}

const SIZE_CLASS: Record<NonNullable<FileTypeIconProps['size']>, string> = {
  sm: 'h-3.5 w-3.5',
  default: 'h-4 w-4',
  lg: 'h-5 w-5',
};

export const FileTypeIcon = React.forwardRef<SVGSVGElement, FileTypeIconProps>(
  ({ filename, mimeType, size = 'default', tinted = true, className, ...props }, ref) => {
    const ext = detectExt(filename);
    const { Icon, tint } = specForExt(ext, mimeType);
    return (
      <Icon
        ref={ref}
        aria-hidden="true"
        className={cn(SIZE_CLASS[size], tinted && tint, className)}
        {...props}
      />
    );
  },
);
FileTypeIcon.displayName = 'FileTypeIcon';
