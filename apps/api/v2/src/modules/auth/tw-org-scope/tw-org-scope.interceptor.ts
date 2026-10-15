import { assertTwOrgId, runWithTwOrg } from "@calcom/prisma/tw-org-context";
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, type Subscription } from "rxjs";

export function twOrgIdOfAuthUser(user: unknown): string | null {
  const value = (user as { twOrgId?: unknown } | null | undefined)?.twOrgId;
  try {
    assertTwOrgId(value);
    return value;
  } catch {
    return null;
  }
}

/**
 * TW-T9.2b1: runs every API v2 handler in the org of the principal the auth guards
 * verified (session user, API key owner or access token owner). Interceptors run after
 * guards, so `request.user` is the verified user row; params, headers and body are never
 * read here (CC-13). No twOrgId means no scope, never a platform fallback.
 */
@Injectable()
export class TwOrgScopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const twOrgId = twOrgIdOfAuthUser(context.switchToHttp().getRequest<{ user?: unknown }>()?.user);
    if (!twOrgId) return next.handle();
    return new Observable((subscriber) => {
      let subscription: Subscription | undefined;
      // The handler is subscribed synchronously inside the scope, so its async work inherits it.
      runWithTwOrg(twOrgId, () => {
        subscription = next.handle().subscribe(subscriber);
      }).catch((err) => subscriber.error(err));
      return () => subscription?.unsubscribe();
    });
  }
}
