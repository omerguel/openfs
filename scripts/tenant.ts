/* ------------------------------------------------------------------ */
/* Operator CLI for multi-tenant mode (uses the same env as the        */
/* server: BASE_DOMAIN, TENANTS_DIR, REGISTRY_PATH).                   */
/*                                                                     */
/*   bun scripts/tenant.ts list                                        */
/*   bun scripts/tenant.ts create <slug> "<Schulname>" <email> "<Name>" */
/*   bun scripts/tenant.ts suspend <slug>                              */
/*   bun scripts/tenant.ts activate <slug>                             */
/*   bun scripts/tenant.ts register <slug> "<Schulname>" <email>       */
/*     (registry entry only, for a school database restored from a     */
/*     backup after the registry was lost — see docs/operations.md)    */
/*                                                                     */
/* `create` prints a generated initial password for the Inhaber        */
/* account. A running server picks new schools up on restart (or at    */
/* once when they sign up through the platform page).                  */
/* ------------------------------------------------------------------ */

import { Registry, TenantManager, tenancyConfigFromEnv } from "../src/server/tenancy";

const config = tenancyConfigFromEnv({ ...process.env, MULTI_TENANT: "1" });
if (!config) throw new Error("unreachable");
const registry = Registry.open(config.registryPath);
const [command, ...args] = process.argv.slice(2);

function randomPassword(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64url");
}

switch (command) {
  case "list": {
    for (const tenant of registry.list()) {
      console.log(
        `${tenant.slug.padEnd(24)} ${tenant.status.padEnd(9)} ${tenant.email.padEnd(30)} ${tenant.name}`,
      );
    }
    break;
  }
  case "create": {
    const [slug, schoolName, email, ownerName] = args;
    if (!slug || !schoolName || !email) {
      console.error('Aufruf: create <slug> "<Schulname>" <email> ["<Name>"]');
      process.exit(1);
    }
    const password = randomPassword();
    const manager = new TenantManager(registry, config);
    await manager.provision({
      slug,
      schoolName,
      email,
      ownerName: ownerName ?? schoolName,
      password,
    });
    manager.closeAll();
    console.log(`Angelegt: https://${slug}.${config.baseDomain}/`);
    console.log(`Anmeldung: ${email.toLowerCase()} / ${password}  (bitte sofort ändern)`);
    break;
  }
  case "register": {
    const [slug, schoolName, email] = args;
    if (!slug || !schoolName || !email) {
      console.error('Aufruf: register <slug> "<Schulname>" <email>');
      process.exit(1);
    }
    registry.insert(slug, schoolName.trim(), email.trim().toLowerCase());
    console.log(`Eingetragen: ${slug} (Datenbank ${config.dir}/${slug}.db)`);
    break;
  }
  case "suspend":
  case "activate": {
    const [slug] = args;
    if (!slug) {
      console.error(`Aufruf: ${command} <slug>`);
      process.exit(1);
    }
    registry.setStatus(slug, command === "suspend" ? "gesperrt" : "aktiv");
    console.log(`${slug}: ${command === "suspend" ? "gesperrt" : "aktiv"}`);
    break;
  }
  default:
    console.error("Befehle: list | create | register | suspend | activate");
    process.exit(1);
}
