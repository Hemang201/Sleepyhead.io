import { createApp, type Env } from './app';

/**
 * The deployed entrypoint.
 *
 * There is no external identity provider: the owner signs in with the address
 * and password configured in this Worker's environment, then confirms a code
 * sent to a separately configured private address. `createApp()` builds one
 * handler per isolate and every request is authorized inside it.
 */

const app = createApp();

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return app(request, env);
  },
};
