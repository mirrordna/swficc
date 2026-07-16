const LOCAL_MONGO_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

export const ALLOW_LOCAL_MONGO = false;

export function mongoHosts(uri) {
  const raw = String(uri || "").trim();
  const match = raw.match(/^mongodb(?:\+srv)?:\/\/([^/?#]+)/i);
  if (!match) return [];
  const authority = match[1].split("@").pop() || "";
  return authority.split(",").map((host) => {
    const clean = host.trim();
    if (!clean) return "";
    if (clean.startsWith("[")) return clean.slice(1).split("]")[0].toLowerCase();
    return clean.split(":")[0].toLowerCase();
  }).filter(Boolean);
}

export function isLocalMongoUri(uri) {
  return mongoHosts(uri).some((host) => LOCAL_MONGO_HOSTS.has(host));
}

export function isRemoteMongoUri(uri) {
  const hosts = mongoHosts(uri);
  return hosts.length > 0 && hosts.every((host) => !LOCAL_MONGO_HOSTS.has(host));
}

export function assertRemoteMongoUri(uri, label = "Mongo URI") {
  if (!isRemoteMongoUri(uri)) {
    throw new Error(`${label} must use an explicit non-local Mongo host. Local Mongo is disabled without exception.`);
  }
  return { remote: true, hosts: mongoHosts(uri) };
}
