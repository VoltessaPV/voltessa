import { execFileSync } from "node:child_process";

/**
 * Voltessa Gateway provisioning milestone (Aug 2026). Every gateway
 * provisioning script drives Headscale the same way this whole milestone
 * has driven it manually throughout development: SSH into the existing
 * Scaleway VM (`voltessa-fusionsolar-proxy`, see
 * docs/infrastructure/scaleway-production.md) and run the `headscale` CLI
 * there. No new credential type, no new infrastructure - this reuses
 * whatever SSH access the operator running the script already has (their
 * own key/agent, exactly as used for every other operation on this VM).
 *
 * Deliberately not Headscale's own gRPC/HTTP admin API + API key - that
 * would be a reasonable upgrade once this needs to run unattended (e.g.
 * triggered from a Voltessa admin UI), but introduces a new credential to
 * store/rotate that isn't justified yet at today's scale (see
 * docs/infrastructure/gateway-provisioning.md).
 */

const HEADSCALE_VM_SSH_TARGET = "root@51.15.103.175";

/** Runs a `headscale ...` command on the VM and returns its raw stdout. Throws with stderr included if the command fails. */
export function runHeadscaleCommand(args: string[]): string {
  const remoteCommand = ["headscale", ...args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`)].join(" ");
  return execFileSync("ssh", ["-o", "ConnectTimeout=15", HEADSCALE_VM_SSH_TARGET, remoteCommand], {
    encoding: "utf-8",
  });
}

/** Runs a `headscale ... -o json` command and parses the result. */
export function runHeadscaleJson<T>(args: string[]): T {
  const output = runHeadscaleCommand([...args, "-o", "json"]);
  return JSON.parse(output) as T;
}

export type HeadscaleUser = { id: number; name: string };
export type HeadscaleNode = {
  id: number;
  name: string;
  given_name: string;
  node_key: string;
  online: boolean;
  tags: string[];
};
export type HeadscalePreAuthKey = { id: number; key: string; expiration: { seconds: number } };

/** Looks up an existing Headscale user by name (e.g. "voltessa-gateways") - never creates one; the gateway-enrollment user is expected to already exist from the Headscale control-plane setup. */
export function findHeadscaleUserId(userName: string): number {
  const users = runHeadscaleJson<HeadscaleUser[]>(["users", "list"]);
  const match = users.find((u) => u.name === userName);
  if (!match) {
    throw new Error(`Headscale user "${userName}" does not exist. It must be created once, out of band, before provisioning any gateway (see docs/infrastructure/gateway-provisioning.md).`);
  }
  return match.id;
}

/** Finds a Headscale node by its hostname/name, or null if it hasn't enrolled (yet). */
export function findHeadscaleNodeByHostname(hostname: string): HeadscaleNode | null {
  const nodes = runHeadscaleJson<HeadscaleNode[]>(["nodes", "list"]);
  return nodes.find((n) => n.name === hostname || n.given_name === hostname) ?? null;
}
