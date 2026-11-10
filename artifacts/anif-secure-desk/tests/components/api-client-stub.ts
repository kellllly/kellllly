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
