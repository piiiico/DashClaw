import { Hash, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { timeAgo } from './helpers';

export default function ThreadList({ threads, onSelect, selectedId }) {
  if (threads.length === 0) {
    return (
      <Card hover={false}>
        <CardContent className="py-6">
          <EmptyState
            icon={Hash}
            title="No threads yet"
            description="Create a new thread to start a conversation, or agents can create threads via the SDK."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card hover={false}>
      <CardContent className="pt-0 divide-y divide-white/[0.04]">
        {threads.map(thread => (
          <div
            key={thread.id}
            onClick={() => onSelect(thread)}
            className={`flex items-start gap-3 py-3 px-1 cursor-pointer transition-colors rounded-sm ${
              thread.id === selectedId ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
            }`}
          >
            <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 bg-white/[0.06]">
              <Hash size={14} className="text-secondary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-secondary truncate">{thread.name || thread.subject || 'Untitled thread'}</span>
                <Badge variant={thread.status === 'open' ? 'success' : 'default'} size="xs">
                  {thread.status}
                </Badge>
              </div>
              <div className="text-xs text-tertiary mt-0.5">
                {thread.message_count || 0} messages · by {thread.created_by}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <span className="text-xs text-disabled">{timeAgo(thread.last_message_at || thread.created_at)}</span>
              <ChevronRight size={12} className="text-zinc-700" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
