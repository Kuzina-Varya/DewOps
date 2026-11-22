#!/usr/bin/env python3
"""POSIX control-node orchestration. All guest configuration belongs to Ansible."""
import ipaddress
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import socket
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / ".lab"
INVENTORY = ROOT / "infra/ansible/inventories/lab/hosts.yml"
VM = os.environ.get("VM_NAME", "quotes-lab3")
KEY = LAB / "id_ed25519"
KNOWN = LAB / "known_hosts"
ALIAS = f"quotes-lab-{VM}"


def execute(args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, text=True, **kwargs)


def mp():
    binary = os.environ.get("MULTIPASS") or shutil.which("multipass") or shutil.which("multipass.exe")
    for fallback in (Path("/snap/bin/multipass"), Path("/mnt/c/Program Files/Multipass/bin/multipass.exe")):
        if not binary and fallback.is_file():
            binary = str(fallback)
    if not binary:
        raise RuntimeError("Install Multipass on the host; on WSL set MULTIPASS to multipass.exe if needed")
    return ["sudo", binary] if os.environ.get("MULTIPASS_SUDO") == "1" else [binary]


def instances():
    return json.loads(execute([*mp(), "list", "--format", "json"], capture_output=True, timeout=60).stdout)["list"]


def current_instance():
    return next((item for item in instances() if item["name"] == VM), None)


def setup():
    LAB.mkdir(mode=0o700, exist_ok=True)
    (LAB / "logs").mkdir(exist_ok=True)
    if not (LAB / "venv/bin/python").exists():
        execute([sys.executable, "-m", "venv", LAB / "venv"])
    execute([LAB / "venv/bin/pip", "install", "--disable-pip-version-check", "-r", ROOT / "tools/requirements-control.txt"])
    execute([LAB / "venv/bin/ansible-galaxy", "collection", "install", "-r",
             ROOT / "infra/ansible/requirements.yml", "-p", LAB / "collections"], env=ansible_env())
    if os.environ.get("WSL_WINDOWS_RELAY") == "1":
        windows_relay()


def windows_relay():
    """Compile an AnyCPU Windows TCP transport; never change the target VM."""
    compiler = Path("/mnt/c/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe")
    if not compiler.is_file():
        raise RuntimeError("WSL_WINDOWS_RELAY requires Windows .NET Framework C# compiler")
    source = ROOT / "tools/windows-tcp-relay.cs"
    binary = LAB / "windows-tcp-relay.exe"
    if not binary.exists() or binary.stat().st_mtime < source.stat().st_mtime:
        winpath = lambda path: execute(["wslpath", "-w", path], capture_output=True).stdout.strip()
        execute([compiler, "/nologo", "/target:exe", "/platform:anycpu",
                 f"/out:{winpath(binary)}", winpath(source)])
    binary.chmod(0o700)
    return str(binary)


def ansible_env():
    return {**os.environ, "ANSIBLE_CONFIG": str(ROOT / "infra/ansible/ansible.cfg"),
            "ANSIBLE_COLLECTIONS_PATH": str(LAB / "collections"), "ANSIBLE_HOST_KEY_CHECKING": "True",
            "ANSIBLE_NOCOLOR": "1"}


def key_material():
    if not KEY.exists():
        execute(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", VM, "-f", KEY])
    KEY.chmod(0o600)
    return Path(f"{KEY}.pub").read_text().strip()


def refresh_inventory(instance):
    if not KNOWN.exists() or not KEY.exists():
        raise RuntimeError("Pinned SSH identity is missing; run make provision first")
    addresses = [ip for ip in instance.get("ipv4", []) if not ipaddress.ip_address(ip).is_loopback]
    if not addresses:
        raise RuntimeError("VM has no IPv4 address reachable from the control node")
    address = addresses[0]
    options = ["-o", "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={KNOWN}",
               "-o", f"HostKeyAlias={ALIAS}", "-o", "IdentitiesOnly=yes"]
    if os.environ.get("WSL_WINDOWS_RELAY") == "1":
        options += ["-o", f"ProxyCommand={shlex.quote(windows_relay())} %h %p"]
    probe = subprocess.run(["ssh", "-F", "/dev/null", "-i", str(KEY), *options,
                            "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", f"admin@{address}", "true"],
                           capture_output=True, text=True, timeout=15)
    login = "admin" if probe.returncode == 0 else "ubuntu"
    common = shlex.join(options)
    # JSON is a YAML subset and avoids quoting bugs in paths and key material.
    data = {"all": {"children": {"scraper_hosts": {"hosts": {"quotes": {
        "ansible_host": address, "ansible_user": login, "ansible_ssh_private_key_file": str(KEY),
        "ansible_ssh_common_args": common,
        "bootstrap_admin_public_key": Path(f"{KEY}.pub").read_text().strip(),
    }}}}}}
    INVENTORY.parent.mkdir(parents=True, exist_ok=True)
    INVENTORY.write_text(json.dumps(data, indent=2) + "\n")
    print(f"Inventory: {address}, initial SSH account: {login}", flush=True)


def provision():
    marker = LAB / "vm.json"
    instance = current_instance()
    if instance and (not marker.exists() or json.loads(marker.read_text())["name"] != VM):
        raise RuntimeError("VM already exists without this lab's ownership marker; choose another VM_NAME")
    if not instance:
        public_key = key_material()
        config = "#cloud-config\n" + (ROOT / "infra/cloud-init.yaml").read_text().replace("__LAB_PUBLIC_KEY__", public_key)
        marker.write_text(json.dumps({"name": VM}))
        (LAB / "cloud-init.yaml").write_text(config)
        execute([*mp(), "launch", "24.04", "--name", VM, "--cpus", "2", "--memory", "4G", "--disk", "20G",
                 "--timeout", "900", "--cloud-init", "-"], input=config, timeout=1000)
        # Bootstrap read-only operations over Multipass's authenticated daemon channel.
        execute([*mp(), "exec", VM, "--", "sudo", "cloud-init", "status", "--wait"], timeout=300)
        host_key = execute([*mp(), "exec", VM, "--", "sudo", "cat", "/etc/ssh/ssh_host_ed25519_key.pub"],
                           capture_output=True, timeout=60).stdout.strip()
        if not host_key.startswith("ssh-ed25519 "):
            raise RuntimeError("Multipass did not return an Ed25519 SSH host public key")
        KNOWN.write_text(f"{ALIAS} {host_key}\n")
        KNOWN.chmod(0o600)
        instance = current_instance()
    elif instance["state"] == "Stopped":
        execute([*mp(), "start", VM], timeout=300)
        instance = current_instance()
    if not KNOWN.exists() or not KEY.exists():
        raise RuntimeError("Pinned SSH identity is missing; destroy and recreate this lab, do not disable host checking")
    refresh_inventory(instance)
    play("site")


def play(name, extra=None):
    if not INVENTORY.exists():
        raise RuntimeError("Generated inventory is missing; run make provision first")
    args = [LAB / "venv/bin/ansible-playbook", "-i", INVENTORY,
            ROOT / f"infra/ansible/playbooks/{name}.yml"]
    if extra:
        args += ["--extra-vars", json.dumps(extra)]
    tunnel = None
    if os.environ.get("WSL_WINDOWS_RELAY") == "1" and name in ("verify", "fault-test"):
        host = json.loads(INVENTORY.read_text())["all"]["children"]["scraper_hosts"]["hosts"]["quotes"]
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        options = shlex.split(host["ansible_ssh_common_args"])
        tunnel = subprocess.Popen(["ssh", "-N", "-i", str(KEY), *options,
                                   "-o", "ExitOnForwardFailure=yes", "-o", "BatchMode=yes",
                                   "-L", f"127.0.0.1:{port}:127.0.0.1:80", f"admin@{host['ansible_host']}"])
        deadline = time.monotonic() + 15
        while True:
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=1):
                    break
            except OSError:
                if tunnel.poll() is not None or time.monotonic() >= deadline:
                    tunnel.terminate()
                    tunnel.wait(timeout=10)
                    raise RuntimeError("SSH HTTP tunnel could not be established") from None
                time.sleep(0.1)
        args += ["--extra-vars", json.dumps({"scraper_http_base_url": f"http://127.0.0.1:{port}"})]
    log_path = LAB / f"logs/{name}.log"
    try:
        with log_path.open("w") as log:
            process = subprocess.Popen([str(arg) for arg in args], env=ansible_env(), text=True,
                                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=ROOT)
            for line in process.stdout:
                print(line, end="", flush=True)
                log.write(line)
            code = process.wait()
    finally:
        if tunnel:
            tunnel.terminate()
            tunnel.wait(timeout=10)
    if code:
        raise RuntimeError(f"Ansible {name} failed ({code}); see {log_path}")
    if name == "site":
        recaps = re.findall(r"ok=\d+\s+changed=(\d+)\s+unreachable=(\d+)\s+failed=(\d+)", log_path.read_text())
        if not recaps:
            raise RuntimeError("Ansible did not produce a recap")
        (LAB / "recap.json").write_text(json.dumps(recaps))


def job(command):
    if command == "verify":
        data = json.loads((LAB / "last-job.json").read_text())
    else:
        data = {"scraper_job_id": str(uuid.uuid4()),
                "scraper_job_url": os.environ.get("URL", "https://quotes.toscrape.com/scroll")}
    play(command, data)
    (LAB / "last-job.json").write_text(json.dumps(data))
    print(f"Job: {data['scraper_job_id']}", flush=True)


def idempotence():
    provision()
    recaps = json.loads((LAB / "recap.json").read_text())
    if any(any(int(value) != 0 for value in recap) for recap in recaps):
        raise RuntimeError("Repeated provision was not changed=0, unreachable=0, failed=0")
    play("deploy")
    deploy_log = (LAB / "logs/deploy.log").read_text()
    if not re.search(r"changed=0\s+unreachable=0\s+failed=0", deploy_log):
        raise RuntimeError("Repeated deploy was not unchanged")


def destroy():
    marker = LAB / "vm.json"
    if marker.exists():
        if json.loads(marker.read_text())["name"] != VM:
            raise RuntimeError("VM_NAME does not match the VM owned by this .lab directory")
        if current_instance():
            execute([*mp(), "delete", "--purge", VM], timeout=300)
    # Only exact, repository-owned generated directories, never global Multipass purge.
    for directory in (LAB, INVENTORY.parent):
        if directory.exists():
            shutil.rmtree(directory)
    print("Lab VM and local generated state removed (or already absent)")


def main():
    if os.name != "posix":
        raise RuntimeError("Use a POSIX control node; on Windows run Make and Ansible inside WSL2")
    if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9-]{0,50}", VM):
        raise RuntimeError("Invalid VM_NAME")
    os.chdir(ROOT)
    command = sys.argv[1]
    if command in ("deploy", "run", "verify", "fault-test"):
        instance = current_instance()
        if not instance or instance["state"] != "Running":
            raise RuntimeError("The lab VM is not running; run make provision first")
        refresh_inventory(instance)
    if command == "setup":
        setup()
    elif command == "provision":
        provision()
    elif command == "deploy":
        play("deploy")
    elif command in ("run", "verify", "fault-test"):
        job(command)
    elif command == "destroy":
        destroy()
    elif command == "idempotence":
        idempotence()
    else:
        raise RuntimeError(f"Unknown operation: {command}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        sys.exit(f"{error}\n{error.stderr or error.stdout or ''}")
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        sys.exit(str(error))
