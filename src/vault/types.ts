/**
 * Common interface that every OS vault backend must implement.
 * Key format: `{namespace}/{name}` — e.g. `my-project/github-token` or `global/npm-token`
 */
export interface VaultBackend {
  /** Human-readable name shown by `see-crets detect` */
  readonly name: string;

  /** Returns true if this backend is available and functional on the current machine */
  isAvailable(): Promise<boolean>;

  /**
   * Store a secret value under the given key.
   * @param key Fully-qualified key — `{namespace}/{name}`
   * @param value The secret value (never logged or returned)
   */
  set(key: string, value: string): Promise<void>;

  /**
   * Retrieve a secret value. Returns null if the key does not exist.
   * Callers must ensure the returned value is never passed to the LLM.
   */
  get(key: string): Promise<string | null>;

  /** Remove a key from the vault. No-op if the key does not exist. */
  delete(key: string): Promise<void>;

  /**
   * List key names whose target starts with `prefix`.
   * Returns only the key names (the `{namespace}/{name}` portion) — never values.
   */
  list(prefix: string): Promise<string[]>;
}

/** Result of `secrets_detect` */
export interface DetectResult {
  available: boolean;
  backend: string;
  detail?: string;
}
