import { AsyncLocalStorage } from 'node:async_hooks';

/** What `writeAudit` needs to know about the request it is running inside, without every call
 *  site passing it down. Set once per request by `hooks.server.ts`. */
export interface RequestContext {
	ip: string | null;
	userAgent: string | null;
	path: string;
	/** True when a signed-in user is attached to the request. */
	hasSession: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <T>(ctx: RequestContext, fn: () => T): T =>
	storage.run(ctx, fn);

/** Undefined outside a request (a job, a script, a webhook retry from the queue). */
export const getRequestContext = (): RequestContext | undefined => storage.getStore();
