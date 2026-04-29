export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Failed to read env var ${name}: not set`);
  }
  return v;
}
