#!/usr/bin/env python3
import json
import socket
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUT = REPO_ROOT / "output" / "swfipn-digitalocean-inventory-latest.json"
DEFAULT_PROJECT_ID = "f67588e6-7782-4cee-8294-1562f7078e0a"
DEFAULT_DROPLET = "swfipn-acceptance"
DEFAULT_DOMAIN = "swfipn.activemirror.ai"
KEYCHAIN_SERVICES = ("swfi-digital-ocean", "digitalocean-swfi-readonly-token")


def keychain_token():
    errors = []
    for service in KEYCHAIN_SERVICES:
        try:
            token = subprocess.check_output(
                ["security", "find-generic-password", "-s", service, "-w"],
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
            if token:
                return service, token
        except subprocess.CalledProcessError as exc:
            errors.append(f"{service}:{exc.returncode}")
    raise RuntimeError("no usable DigitalOcean token in Keychain: " + ", ".join(errors))


def api_get(token, path):
    req = urllib.request.Request(
        f"https://api.digitalocean.com/v2{path}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def paged(token, path, key):
    page = 1
    rows = []
    while True:
        sep = "&" if "?" in path else "?"
        body = api_get(token, f"{path}{sep}per_page=200&page={page}")
        rows.extend(body.get(key, []))
        if not body.get("links", {}).get("pages", {}).get("next"):
            return rows
        page += 1


def tcp_probe(host, port, timeout=4):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def curl(args):
    try:
        run = subprocess.run(
            ["curl", "-sS", "-m", "15", *args],
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        return {"exit_code": run.returncode, "stdout": run.stdout[:2000], "stderr": run.stderr[:1000]}
    except FileNotFoundError:
        return {"exit_code": 127, "stdout": "", "stderr": "curl not found"}


def main():
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    out_path.parent.mkdir(parents=True, exist_ok=True)
    service, token = keychain_token()

    droplets = paged(token, "/droplets", "droplets")
    project = api_get(token, f"/projects/{DEFAULT_PROJECT_ID}").get("project")
    resources = paged(token, f"/projects/{DEFAULT_PROJECT_ID}/resources", "resources")
    keys = paged(token, "/account/keys", "ssh_keys")
    target = next((d for d in droplets if d.get("name") == DEFAULT_DROPLET), None)

    ip = None
    if target:
        ip = next(
            (
                net.get("ip_address")
                for net in target.get("networks", {}).get("v4", [])
                if net.get("type") == "public"
            ),
            None,
        )

    forced_origin = None
    if ip:
        forced_origin = curl(
            [
                "--resolve",
                f"{DEFAULT_DOMAIN}:443:{ip}",
                "-I",
                f"https://{DEFAULT_DOMAIN}/swficc/",
            ]
        )

    receipt = {
        "schema_version": "swfipn.digitalocean_inventory.v1",
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "keychain_service": service,
        "project_id": DEFAULT_PROJECT_ID,
        "project": {
            "name": project.get("name") if project else None,
            "environment": project.get("environment") if project else None,
            "purpose": project.get("purpose") if project else None,
        },
        "droplet": {
            "found": bool(target),
            "id": target.get("id") if target else None,
            "name": target.get("name") if target else DEFAULT_DROPLET,
            "status": target.get("status") if target else None,
            "region": target.get("region", {}).get("slug") if target else None,
            "size": target.get("size", {}).get("slug") if target else None,
            "memory_mb": target.get("memory") if target else None,
            "vcpus": target.get("vcpus") if target else None,
            "disk_gb": target.get("disk") if target else None,
            "image": (target.get("image") or {}).get("slug") or (target.get("image") or {}).get("name") if target else None,
            "created_at": target.get("created_at") if target else None,
            "ipv4_public": ip,
            "tags": target.get("tags") if target else [],
        },
        "project_resources": [
            {
                "urn": item.get("urn"),
                "assigned_at": item.get("assigned_at"),
                "status": item.get("status"),
            }
            for item in resources
        ],
        "account_ssh_keys": [
            {"name": item.get("name"), "fingerprint": item.get("fingerprint"), "id": item.get("id")}
            for item in keys
        ],
        "reachability": {
            "tcp_22": tcp_probe(ip, 22) if ip else False,
            "tcp_80": tcp_probe(ip, 80) if ip else False,
            "tcp_443": tcp_probe(ip, 443) if ip else False,
            "forced_origin_status": forced_origin,
        },
        "notes": [
            "Read-only DigitalOcean API inventory. No cloud resources are modified.",
            "SSH may still fail if the local public key is not present in the droplet authorized_keys.",
        ],
    }
    out_path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(f"droplet={receipt['droplet']['name']} status={receipt['droplet']['status']} ip={receipt['droplet']['ipv4_public']}")
    print(f"ports=22:{receipt['reachability']['tcp_22']} 80:{receipt['reachability']['tcp_80']} 443:{receipt['reachability']['tcp_443']}")
    print(f"receipt={out_path}")


if __name__ == "__main__":
    main()
