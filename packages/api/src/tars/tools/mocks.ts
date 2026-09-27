/**
 * Test double for pwc_tars's `POST /api/langflow-service/tools/<name>/stream`:
 * the SSE body it sends for a run that would have answered the JSON route with
 * `status` / `body` — progress frames first, then the result, or the failure as
 * an error frame (the stream itself is always a 200). Shared by the specs of
 * every tool that calls a pwc_tars tool directly.
 */
export function tarsToolStreamResponse(
  status: number,
  body: unknown,
  progress: readonly string[] = [],
): Response {
  const envelope = (body ?? {}) as { data?: unknown; message?: string };
  const frames: unknown[] = progress.map((message) => ({
    type: 'progress',
    kind: 'table_task',
    message,
  }));
  frames.push(
    status < 300
      ? { type: 'result', data: envelope.data }
      : { type: 'error', message: envelope.message, status },
  );
  const text = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('');
  return new Response(`: keepalive\n\n${text}`, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
