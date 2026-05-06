import type { Paddle } from "@paddle/paddle-js";

let _paddle: Paddle | null = null;
let _initializing = false;
let _initPromise: Promise<Paddle | null> | null = null;

export function isPaddleConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_PADDLE_CLIENT_TOKEN &&
    (import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string).trim().length > 0,
  );
}

export async function getPaddle(): Promise<Paddle | null> {
  if (!isPaddleConfigured()) return null;
  if (_paddle) return _paddle;
  if (_initPromise) return _initPromise;

  _initializing = true;
  _initPromise = (async () => {
    try {
      const { initializePaddle } = await import("@paddle/paddle-js");
      const paddleEnv = (import.meta.env.VITE_PADDLE_ENV as string | undefined) ?? "sandbox";
      const token = import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string;

      const instance = await initializePaddle({
        environment: paddleEnv as "sandbox" | "production",
        token,
      });
      _paddle = instance ?? null;
      return _paddle;
    } catch (err) {
      console.error("[Paddle] Failed to initialize:", err);
      return null;
    } finally {
      _initializing = false;
    }
  })();

  return _initPromise;
}

export function resetPaddleInstance(): void {
  _paddle = null;
  _initializing = false;
  _initPromise = null;
}
