import { readFileSync } from "fs";
import { join } from "path";

/**
 * Built-in map from well-known vault key-name suffixes to standard env var names.
 *
 * Matching is suffix-based: `my-app/github-token` matches `github-token`.
 * All keys are lowercase; env var names are the canonical form expected by the tool.
 */
export const BUILTIN_MAP: Record<string, string> = {
  "github-token": "GITHUB_TOKEN",
  "azure-devops-pat": "AZURE_DEVOPS_PAT",
  "database-url": "DATABASE_URL",
  "npm-token": "NPM_TOKEN",
  "docker-password": "DOCKER_PASSWORD",
  "aws-access-key-id": "AWS_ACCESS_KEY_ID",
  "aws-secret-access-key": "AWS_SECRET_ACCESS_KEY",
  "openai-api-key": "OPENAI_API_KEY",
  "anthropic-api-key": "ANTHROPIC_API_KEY",
  "slack-token": "SLACK_TOKEN",
  "stripe-secret-key": "STRIPE_SECRET_KEY",
  "sendgrid-api-key": "SENDGRID_API_KEY",
  "twilio-auth-token": "TWILIO_AUTH_TOKEN",
  "firebase-service-account": "FIREBASE_SERVICE_ACCOUNT",
  "google-application-credentials": "GOOGLE_APPLICATION_CREDENTIALS",
  "gcp-service-account": "GOOGLE_APPLICATION_CREDENTIALS",
  "azure-client-secret": "AZURE_CLIENT_SECRET",
  "azure-tenant-id": "AZURE_TENANT_ID",
  "azure-client-id": "AZURE_CLIENT_ID",
  "heroku-api-key": "HEROKU_API_KEY",
};

/** Schema of .see-crets.json */
interface SecretsConfig {
  map?: Record<string, string>;
}

/**
 * Load and validate `.see-crets.json` from the given directory.
 *
 * Returns an empty object if the file does not exist (not an error — optional file).
 * Throws a descriptive `Error` if the file exists but is malformed or has the wrong shape.
 */
export function loadProjectConfig(dir: string): Record<string, string> {
  const configPath = join(dir, ".see-crets.json");
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (err: unknown) {
    // File not present — that's fine
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw new Error(
      `.see-crets.json could not be read at "${configPath}": ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    throw new Error(
      `.see-crets.json at "${configPath}" is not valid JSON: ${(err as Error).message}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `.see-crets.json at "${configPath}" must be a JSON object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
    );
  }

  const config = parsed as Record<string, unknown>;
  if ("map" in config) {
    const map = config.map;
    if (typeof map !== "object" || map === null || Array.isArray(map)) {
      throw new Error(
        `.see-crets.json at "${configPath}": "map" must be an object mapping key-name suffixes to env var names`,
      );
    }
    for (const [k, v] of Object.entries(map)) {
      if (typeof v !== "string") {
        throw new Error(
          `.see-crets.json at "${configPath}": map["${k}"] must be a string, got ${typeof v}`,
        );
      }
    }
    return map as Record<string, string>;
  }

  return {};
}

/**
 * Resolve the effective env-var mapping for a project directory.
 *
 * Merges the built-in map with any per-project overrides from `.see-crets.json`.
 * Per-project overrides take precedence over built-in entries.
 *
 * @param projectDir  Git root (or any directory containing .see-crets.json).
 *                    Pass `undefined` to use built-in map only.
 */
export function resolveEnvMap(
  projectDir?: string,
): Record<string, string> {
  const overrides = projectDir ? loadProjectConfig(projectDir) : {};
  return { ...BUILTIN_MAP, ...overrides };
}

/**
 * Given a fully-qualified vault key (e.g. `my-app/github-token` or `global/openai-api-key`)
 * and an env map, return the target env var name, or `undefined` if no mapping exists.
 *
 * Matching uses the key's suffix (the part after the last `/`).
 */
export function envVarForKey(
  qualifiedKey: string,
  envMap: Record<string, string>,
): string | undefined {
  const suffix = qualifiedKey.includes("/")
    ? qualifiedKey.slice(qualifiedKey.lastIndexOf("/") + 1)
    : qualifiedKey;
  return Object.hasOwn(envMap, suffix) ? envMap[suffix] : undefined;
}
