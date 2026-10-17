/**
 * Host face for the Roselia — Nocturne browser plugin.
 *
 * DSH discovers the browser entry through package.json's dsh.client field.
 * A Host Config would not automatically reach the browser: the first release
 * intentionally owns no Host settings and requires no Host services.
 */
export const name = 'display-roselia-nocturne'

/** Register the package without altering the Host or its configuration. */
export function apply(): void {}
