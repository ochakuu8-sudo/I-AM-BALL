type Registry = {
  registerTool(
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute(input: unknown): unknown;
    },
    options: { signal: AbortSignal },
  ): void | Promise<void>;
};
type Game = {
  getState(): object;
  setPaused(value: boolean): void;
  reset(): void;
};

function validate(
  input: unknown,
  keys: string[] = [],
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Expected an object.');
  const obj = input as Record<string, unknown>;
  if (Object.keys(obj).some((key) => !keys.includes(key)))
    throw new Error('Unexpected input field.');
  return obj;
}
const afterPaint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

export function registerGameTools(game: Game) {
  const registry = (document as Document & { modelContext?: Registry })
    .modelContext;
  if (!registry?.registerTool) return () => {};
  const lifecycle = new AbortController();
  const definitions = [
    {
      name: 'get_rolling_town_state',
      title: 'Read Rolling Town state',
      description:
        'Read ball position, speed, distance, jumps, broken-piece count, active debris, camera angles and pause state.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      readOnly: true,
      execute(input: unknown) {
        validate(input);
        return game.getState();
      },
    },
    {
      name: 'set_rolling_town_paused',
      title: 'Pause or resume Rolling Town',
      description:
        'Pause or resume the same simulation controlled by the visible pause button.',
      inputSchema: {
        type: 'object',
        properties: { paused: { type: 'boolean' } },
        required: ['paused'],
        additionalProperties: false,
      },
      readOnly: false,
      async execute(input: unknown) {
        const obj = validate(input, ['paused']);
        if (typeof obj.paused !== 'boolean')
          throw new Error('paused must be a boolean.');
        game.setPaused(obj.paused);
        await afterPaint();
        return game.getState();
      },
    },
    {
      name: 'reset_rolling_town',
      title: 'Reset Rolling Town',
      description:
        'Restore the ball, all destructible parts and movable objects, clear counters and reset the camera, just like the visible reset button.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      readOnly: false,
      async execute(input: unknown) {
        validate(input);
        game.reset();
        await afterPaint();
        return game.getState();
      },
    },
  ];
  for (const tool of definitions) {
    try {
      void Promise.resolve(
        registry.registerTool(
          {
            ...tool,
            annotations: {
              readOnlyHint: tool.readOnly,
              untrustedContentHint: false,
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {
      /* Optional browser capability: gameplay continues when registration is unavailable. */
    }
  }
  return () => lifecycle.abort();
}
