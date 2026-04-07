/** Key validation applied by all vault backends. */
export function validateKey(key: string): void {
  if (/[\r\n]/.test(key)) {
    throw new Error(`Invalid key '${key}': key must not contain newlines`);
  }
  if (key !== key.trim()) {
    throw new Error(
      `Invalid key '${key}': key must not have leading or trailing whitespace`
    );
  }
  if (key.split("/").some((seg) => seg === ".." || seg === ".")) {
    throw new Error(
      `Invalid key '${key}': key must not contain path traversal segments`
    );
  }
}
