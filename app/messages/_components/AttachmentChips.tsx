import { Paperclip, Download, Image as ImageIcon, FileText } from 'lucide-react';

interface AttachmentChipsProps {
  attachments?: any[];
  compact?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function isImageType(mimeType: string | undefined): boolean {
  return !!mimeType?.startsWith('image/');
}

export default function AttachmentChips({ attachments, compact }: AttachmentChipsProps) {
  if (!attachments || attachments.length === 0) return null;

  const attachmentUrl = (att: any) => `/api/messages/attachments?id=${att.id}`;

  return (
    <div className={`flex flex-wrap gap-2 ${compact ? 'mt-1.5' : 'mt-2'}`}>
      {attachments.map(att => (
        <a
          key={att.id}
          href={attachmentUrl(att)}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] transition-colors text-xs text-secondary"
        >
          {isImageType(att.mime_type) ? (
            <ImageIcon size={compact ? 10 : 12} className="text-info flex-shrink-0" />
          ) : (
            <FileText size={compact ? 10 : 12} className="text-secondary flex-shrink-0" />
          )}
          <span className="truncate max-w-[120px]">{att.filename}</span>
          <span className="text-tertiary">{formatSize(att.size_bytes)}</span>
          <Download size={10} className="opacity-0 group-hover:opacity-100 transition-opacity text-secondary" />
        </a>
      ))}
    </div>
  );
}
