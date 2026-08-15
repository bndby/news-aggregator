import { app } from "./app";
import { runPipeline } from "./pipeline/run";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/styles.css")) return env.ASSETS.fetch(request);
    return app.fetch(request, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const result = await runPipeline(env);
    console.log(`Pipeline complete: ${result.added} articles, ${result.failures.length} failures`);
    for (const failure of result.failures) console.error(failure);
  },
};
