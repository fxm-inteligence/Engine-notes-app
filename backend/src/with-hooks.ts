/** What a person writes around the calls of a Service: `before[name](...args)` runs ahead of the call and may refuse it by throwing; `after[name](result, ...args)` returns what the call answers. */
export type Hooks<T> = {
  before?: {
    [K in keyof T]?: T[K] extends (...args: infer A) => unknown
      ? (...args: A) => void | Promise<void>
      : never;
  };
  after?: {
    [K in keyof T]?: T[K] extends (...args: infer A) => infer R
      ? (result: Awaited<R>, ...args: A) => Awaited<R> | Promise<Awaited<R>>
      : never;
  };
};

/** Wraps the methods of `target` (an object, or a class prototype) that have a hook; the rest stay as they are. */
export function withHooks<T extends object>(target: T, hooks: Hooks<T>): T {
  const record = target as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(target)) {
    const original = record[name];
    const before = (hooks.before as Record<string, ((...args: unknown[]) => unknown) | undefined> | undefined)?.[name];
    const after = (hooks.after as Record<string, ((...args: unknown[]) => unknown) | undefined> | undefined)?.[name];
    if (name === "constructor" || typeof original !== "function" || (!before && !after)) continue;
    record[name] = async function (this: unknown, ...args: unknown[]) {
      await before?.apply(this, args);
      const result = await original.apply(this, args);
      return after ? after.apply(this, [result, ...args]) : result;
    };
  }
  return target;
}
