import { useState } from 'react';
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
export const getItsmSessionMarker = call('getItsmSessionMarker');
export const getHealthCheckQueryKey = () => ['/api/healthz'];
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
