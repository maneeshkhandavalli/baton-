/**
 * Next.js instrumentation hook. Only one job today: in LOCAL DEVELOPMENT, start the background processing
 * drain (lib/pipeline/dev-drain-loop.ts). Production keeps using the protected cron route
 * (app/api/pipeline/drain) and is unaffected: the loop refuses to start unless NODE_ENV is "development".
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "development") return;
  const { startDevDrainLoop } = await import("./lib/pipeline/dev-drain-loop");
  startDevDrainLoop();
}
