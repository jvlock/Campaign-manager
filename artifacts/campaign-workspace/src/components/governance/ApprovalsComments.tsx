import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MessageSquare, ThumbsUp, Send, Loader2, Plus } from 'lucide-react';
import {
  RecordType,
  useListGovernanceComments,
  useCreateGovernanceComment,
  useListGovernanceApprovals,
  useCreateGovernanceApproval,
  useUpdateGovernanceApproval,
  getListGovernanceCommentsQueryOptions,
  getListGovernanceApprovalsQueryOptions,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

type ApprovalStatus = 'pending' | 'in_review' | 'approved' | 'rejected';

type ApprovalRecord = {
  id: string;
  recordType: RecordType;
  recordId: string;
  stage: string;
  status: string;
  approver: string;
  actor?: string;
  reason?: string;
  createdAt?: string;
};

type CommentRecord = {
  id: string;
  recordType: RecordType;
  recordId: string;
  body: string;
  actor: string;
  createdAt?: string;
};

function asApproval(value: unknown): ApprovalRecord | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== 'string'
    || typeof item.recordType !== 'string'
    || typeof item.recordId !== 'string'
    || typeof item.stage !== 'string'
    || typeof item.status !== 'string'
    || typeof item.approver !== 'string'
  ) return null;
  return item as ApprovalRecord;
}

function asComment(value: unknown): CommentRecord | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== 'string'
    || typeof item.recordType !== 'string'
    || typeof item.recordId !== 'string'
    || typeof item.body !== 'string'
    || typeof item.actor !== 'string'
  ) return null;
  return item as CommentRecord;
}

const approvalStatuses: ApprovalStatus[] = ['pending', 'in_review', 'approved', 'rejected'];

export default function ApprovalsComments({ recordType, recordId }: { recordType: RecordType; recordId: string }) {
  const queryClient = useQueryClient();
  const target = { recordType, recordId };
  const commentsQuery = useListGovernanceComments(target, {
    query: {
      ...getListGovernanceCommentsQueryOptions(target),
      enabled: Boolean(recordId),
    },
  });
  const approvalsQuery = useListGovernanceApprovals(target, {
    query: {
      ...getListGovernanceApprovalsQueryOptions(target),
      enabled: Boolean(recordId),
    },
  });
  const createComment = useCreateGovernanceComment();
  const createApproval = useCreateGovernanceApproval();
  const updateApproval = useUpdateGovernanceApproval();

  const [commentBody, setCommentBody] = useState('');
  const [commentActor, setCommentActor] = useState('');
  const [commentReason, setCommentReason] = useState('');
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [stage, setStage] = useState('');
  const [approver, setApprover] = useState('');
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>('pending');
  const [approvalActor, setApprovalActor] = useState('');
  const [approvalReason, setApprovalReason] = useState('');
  const [error, setError] = useState('');

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListGovernanceCommentsQueryOptions(target).queryKey });
    queryClient.invalidateQueries({ queryKey: getListGovernanceApprovalsQueryOptions(target).queryKey });
  };

  const handleSendComment = () => {
    setError('');
    if (!commentBody.trim() || !commentActor.trim() || !commentReason.trim()) {
      setError('Comment body, actor, and reason are required.');
      return;
    }
    createComment.mutate(
      {
        data: {
          recordType,
          recordId,
          body: commentBody.trim(),
          actor: commentActor.trim(),
          reason: commentReason.trim(),
        },
      },
      {
        onSuccess: () => {
          setCommentBody('');
          invalidate();
        },
        onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : 'Unable to add the comment.'),
      },
    );
  };

  const handleCreateApproval = () => {
    setError('');
    if (!stage.trim() || !approver.trim() || !approvalActor.trim() || !approvalReason.trim()) {
      setError('Approval stage, approver, actor, and reason are required.');
      return;
    }
    createApproval.mutate(
      {
        data: {
          recordType,
          recordId,
          stage: stage.trim(),
          status: approvalStatus,
          approver: approver.trim(),
          actor: approvalActor.trim(),
          reason: approvalReason.trim(),
        },
      },
      {
        onSuccess: () => {
          setApprovalOpen(false);
          invalidate();
        },
        onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : 'Unable to create the approval.'),
      },
    );
  };

  const handleApprovalStatus = (approval: ApprovalRecord, status: ApprovalStatus) => {
    setError('');
    if (!approvalActor.trim() || !approvalReason.trim()) {
      setError('Enter the self-declared actor and reason before changing approval status.');
      return;
    }
    updateApproval.mutate(
      {
        id: approval.id,
        data: {
          status,
          actor: approvalActor.trim(),
          reason: approvalReason.trim(),
        },
      },
      {
        onSuccess: invalidate,
        onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : 'Unable to update the approval.'),
      },
    );
  };

  const comments = useMemo(() => (commentsQuery.data ?? []).map(asComment).filter((value): value is CommentRecord => Boolean(value)), [commentsQuery.data]);
  const approvals = useMemo(() => (approvalsQuery.data ?? []).map(asApproval).filter((value): value is ApprovalRecord => Boolean(value)), [approvalsQuery.data]);
  const items = [
    ...comments.map((comment) => ({ ...comment, itemType: 'comment' as const })),
    ...approvals.map((approval) => ({ ...approval, itemType: 'approval' as const })),
  ].sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());

  const isLoading = commentsQuery.isLoading || approvalsQuery.isLoading;
  if (isLoading) {
    return (
      <Card className="shadow-sm">
        <CardHeader><CardTitle>Approvals & Comments</CardTitle></CardHeader>
        <CardContent className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Approvals & Comments</CardTitle>
        <CardDescription>Target: {recordType} / {recordId}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{error}</div>}
        {(commentsQuery.error || approvalsQuery.error) && !error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            Unable to load the selected governance record history.
          </div>
        )}
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6 border border-dashed rounded-md">No comments or approvals yet.</div>
        ) : (
          <div className="max-h-64 overflow-auto space-y-4 pr-2">
            {items.map((item) => (
              <div key={`${item.itemType}-${item.id}`} className={`flex gap-3 text-sm ${item.itemType === 'approval' ? 'bg-green-50/50 p-2 rounded border border-green-100' : ''}`}>
                <div className="mt-0.5 shrink-0">
                  {item.itemType === 'approval' ? <ThumbsUp className="h-4 w-4 text-green-600" /> : <MessageSquare className="h-4 w-4 text-muted-foreground" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-xs">{item.itemType === 'approval' ? item.approver : item.actor}</span>
                    {item.itemType === 'approval' && <span className="text-[10px] text-muted-foreground">{item.stage}</span>}
                    <span className="text-[10px] text-muted-foreground">{item.createdAt ? new Date(item.createdAt).toLocaleString() : 'Recorded time unavailable'}</span>
                  </div>
                  {item.itemType === 'approval' ? (
                    <div className="mt-1 flex items-center gap-2">
                      <select
                        className="h-7 rounded-md border border-input bg-transparent px-2 text-xs"
                        value={approvalStatuses.includes(item.status as ApprovalStatus) ? item.status : 'pending'}
                        onChange={(event) => handleApprovalStatus(item, event.target.value as ApprovalStatus)}
                        disabled={updateApproval.isPending}
                      >
                        {approvalStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                      <span className="text-xs text-muted-foreground">Status</span>
                    </div>
                  ) : (
                    <div className="text-muted-foreground mt-0.5">{item.body}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="comment-actor" className="text-xs">Comment actor (self-declared)</Label>
            <Input id="comment-actor" value={commentActor} onChange={(event) => setCommentActor(event.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="comment-reason" className="text-xs">Comment reason</Label>
            <Input id="comment-reason" value={commentReason} onChange={(event) => setCommentReason(event.target.value)} className="h-8 text-xs" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={commentBody}
            onChange={(event) => setCommentBody(event.target.value)}
            placeholder="Add a comment..."
            className="flex-1 text-sm h-9"
            onKeyDown={(event) => event.key === 'Enter' && handleSendComment()}
            disabled={createComment.isPending}
          />
          <Button size="icon" className="h-9 w-9 shrink-0" onClick={handleSendComment} disabled={createComment.isPending || !commentBody.trim()}>
            {createComment.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>

        <div className="border-t border-border pt-3">
          <Button variant="outline" size="sm" onClick={() => setApprovalOpen((value) => !value)}><Plus className="mr-2 h-4 w-4" />New approval</Button>
          {approvalOpen && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Input value={stage} onChange={(event) => setStage(event.target.value)} placeholder="Stage" />
              <Input value={approver} onChange={(event) => setApprover(event.target.value)} placeholder="Approver" />
              <select className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" value={approvalStatus} onChange={(event) => setApprovalStatus(event.target.value as ApprovalStatus)}>
                {approvalStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
              <Input value={approvalActor} onChange={(event) => setApprovalActor(event.target.value)} placeholder="Actor (self-declared)" />
              <Input className="sm:col-span-2" value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} placeholder="Reason for approval record or status change" />
              <Button className="sm:col-span-2" onClick={handleCreateApproval} disabled={createApproval.isPending}>
                {createApproval.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Create approval
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}