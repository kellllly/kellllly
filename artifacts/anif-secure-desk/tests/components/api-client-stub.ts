import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
/**
 * Stand-in for @workspace/api-client-react in component tests: each test sets
 * the answers it needs and reads the calls the component made.
 */
type Handler = (...args: unknown[]) => Promise<unknown>;
export const handlers: Record<string, Handler> = {};
export const calls: Array<{ name: string; args: unknown[] }> = [];
const call = (name: string) => (...args: unknown[]) => {
  calls.push({ name, args });
  const handler = handlers[name];
  return handler ? handler(...args) : Promise.reject(new Error(`no handler for ${name}`));
};
export const getItsmAuditIntegrity = call('getItsmAuditIntegrity');
export const getItsmAuditProof = call('getItsmAuditProof');
export const getItsmAuditTimestamps = call('getItsmAuditTimestamps');
export const createItsmAuditTimestamp = call('createItsmAuditTimestamp');
export const getItsmUserDirectory = call('getItsmUserDirectory');
export const getItsmRoleReconciliation = call('getItsmRoleReconciliation');
export const assignItsmRole = call('assignItsmRole');
export const attestItsmRole = call('attestItsmRole');
export const checkItsmRoleArchive = call('checkItsmRoleArchive');
export const getItsmWorkspace = call('getItsmWorkspace');
export const getGetItsmUserDirectoryQueryKey = (params?: unknown) => (params ? ['/api/itsm/users', params] : ['/api/itsm/users']);
export const getItsmContacts = call('getItsmContacts');
export const getItsmWorkspaceVersion = call('getItsmWorkspaceVersion');
export const postItsmTemporaryMessage = call('postItsmTemporaryMessage');
export const editItsmMessage = call('editItsmMessage');
export const deleteItsmMessage = call('deleteItsmMessage');
export const setItsmPresence = call('setItsmPresence');
export const setItsmNotificationReads = call('setItsmNotificationReads');
export const getItsmSessionMarker = call('getItsmSessionMarker');
export const getHealthCheckQueryKey = () => ['/api/healthz'];
export type ItsmMyRequestInput = {
  kind: 'Incident' | 'Demande';
  title: string;
  category: 'Applications' | 'Poste de travail' | 'Équipement' | 'Réseau' | 'Accès';
  description: string;
  serviceId: string | null;
};
type ItsmMyRequestView = {
  id: string; title: string; kind: 'Incident' | 'Demande'; category: string; status: string;
  priority: string; serviceId: string | null; serviceName: string | null; description: string; openedAt: string;
  requestApproval: { status: 'pending' | 'approved' | 'rejected'; reason: string | null; decidedAt: string | null } | null;
};
type ItsmMyRequestsView = {
  requests: ItsmMyRequestView[];
  services: Array<{ id: string; name: string; category: string }>;
};
export const getGetItsmMyRequestsQueryKey = () => ['/api/itsm/my-requests'] as const;
export const useGetItsmMyRequests = () => useQuery({
  queryKey: getGetItsmMyRequestsQueryKey(),
  queryFn: () => call('getItsmMyRequests')() as Promise<ItsmMyRequestsView>,
});
export const useCreateItsmMyRequest = () => {
  const [state, setState] = useState<{ isPending: boolean; isError: boolean; error?: unknown }>({ isPending: false, isError: false });
  return {
    ...state,
    mutateAsync: async ({ data }: { data: ItsmMyRequestInput }) => {
      setState({ isPending: true, isError: false });
      try {
        const result = await call('createItsmMyRequest')(data) as { request: ItsmMyRequestView };
        setState({ isPending: false, isError: false });
        return result;
      } catch (error) {
        setState({ isPending: false, isError: true, error });
        throw error;
      }
    },
  };
};
export const useDecideItsmRequestApproval = () => ({
  isPending: false,
  mutateAsync: ({ requestId, data }: { requestId: string; data: { decision: 'approve' | 'reject'; reason?: string } }) =>
    call('decideItsmRequestApproval')(requestId, data),
});
export const useReviewItsmKnowledgeArticle = () => ({
  isPending: false,
  mutateAsync: ({ articleId, data }: { articleId: string; data: Record<string, unknown> }) =>
    call('reviewItsmKnowledgeArticle')(articleId, data),
});
/** Health check seen by the diagnostic assistant: tests set what the next refetch returns. */
export const health: { next: { status: string } | 'error' } = { next: { status: 'ok' } };
export const useHealthCheck = (_options?: unknown) => {
  const [state, setState] = useState<{ data?: { status: string }; isError: boolean; isFetching: boolean }>({ isError: false, isFetching: false });
  const refetch = async () => {
    calls.push({ name: 'healthCheck', args: [] });
    const next = health.next;
    setState(next === 'error' ? { isError: true, isFetching: false } : { data: next, isError: false, isFetching: false });
    return next === 'error' ? { data: undefined } : { data: next };
  };
  return { ...state, refetch };
};
