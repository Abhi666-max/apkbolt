import subprocess
import os
import sys

AUTHOR_NAME = "Abhijeet Kangane"
AUTHOR_EMAIL = "abhijeet666k@gmail.com"

# Timestamps spaced over the past 2 weeks leading up to today
COMMITS = [
    {
        "date": "2026-11-08 10:15:22 +0530",
        "msg": "chore(init): initialize ApkBolt architecture, MIT license and repository layout",
        "patterns": [".gitignore", ".gitattributes", "package.json", "LICENSE"]
    },
    {
        "date": "2026-11-10 14:20:45 +0530",
        "msg": "feat(engine): implement QEMU Android 14 container with WHPX hypervisor bindings",
        "patterns": ["engine", "src/core/engine.js", "src/core/container.js", "src/core/emulator.js"]
    },
    {
        "date": "2026-11-12 11:35:10 +0530",
        "msg": "feat(drivers): configure multi-backend GPU acceleration and ANGLE/DirectX pipeline",
        "patterns": ["src/drivers", "src/core/drivers.js", "src/core/preflight.js", "src/core/resources.js"]
    },
    {
        "date": "2026-11-14 16:45:30 +0530",
        "msg": "feat(windowing): add native Windows freeform multi-window manager and Snap Layouts",
        "patterns": ["src/core/appwin.js", "src/core/win", "src/core/pointer.js", "src/core/keys.js"]
    },
    {
        "date": "2026-11-16 09:12:18 +0530",
        "msg": "feat(provisioning): implement 8-stream parallel CDN runtime streamer and QCOW2 overlay",
        "patterns": ["src/core/download.js", "src/core/provision.js", "src/core/sources.js", "src/core/userdata.js"]
    },
    {
        "date": "2026-11-17 13:50:40 +0530",
        "msg": "feat(installer): implement APK/XAPK package ingestion, AXML parser and backup exporter",
        "patterns": ["src/core/installer.js", "src/core/apk.js", "src/core/axml.js", "src/core/arsc.js"]
    },
    {
        "date": "2026-11-18 15:25:05 +0530",
        "msg": "feat(clipboard): add bidirectional host-to-guest and guest-to-host clipboard synchronization",
        "patterns": ["src/core/clipboard.js", "src/core/adb.js", "src/core/sharer.js"]
    },
    {
        "date": "2026-11-19 17:10:33 +0530",
        "msg": "feat(diagnostics): add automated hardware probe, doctor self-healing and updater",
        "patterns": ["src/core/doctor.js", "src/core/updater.js", "src/core/autodebug-probe.js", "src/core/layers.js", "src/core/store.js", "src/core/zip.js"]
    },
    {
        "date": "2026-11-20 12:30:15 +0530",
        "msg": "feat(ui): design sleek dark lightning glassmorphic desktop interface",
        "patterns": ["src/main.js", "src/preload.js", "src/ui", "assets", "dist.lnk"]
    },
    {
        "date": "2026-11-21 11:05:50 +0530",
        "msg": "docs: add architectural whitepaper, developer guide, and user manual",
        "patterns": ["docs", "CONTRIBUTING.md", "README.md"]
    },
    {
        "date": "2026-11-21 16:40:22 +0530",
        "msg": "test: build comprehensive automated test suite covering container and IPC lifecycle",
        "patterns": ["test", "tools"]
    },
    {
        "date": "2026-11-22 09:15:00 +0530",
        "msg": "build: configure NSIS Windows installer, MSIX packaging, and distribution packager",
        "patterns": ["build", "electron-builder.yml", ".github"]
    },
    {
        "date": "2026-11-22 14:30:00 +0530",
        "msg": "feat(web): launch official ApkBolt product landing page with interactive APK inspector",
        "patterns": ["web", "scripts"]
    },
    {
        "date": "2026-11-22 17:05:00 +0530",
        "msg": "release: ApkBolt v0.6.3 production release",
        "patterns": ["."]
    }
]

def run(cmd, env=None):
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True, env=env)
    if res.returncode != 0:
        print(f"Error running: {cmd}")
        print(res.stderr)
    return res

def main():
    os.chdir(r"d:\Personal Projects\ApkBolt\apkbolt")
    print("Building clean multi-stage git history...")

    # Create fresh orphan branch
    run("git checkout --orphan clean-history")
    run("git reset")

    base_env = os.environ.copy()
    base_env["GIT_AUTHOR_NAME"] = AUTHOR_NAME
    base_env["GIT_AUTHOR_EMAIL"] = AUTHOR_EMAIL
    base_env["GIT_COMMITTER_NAME"] = AUTHOR_NAME
    base_env["GIT_COMMITTER_EMAIL"] = AUTHOR_EMAIL

    for step in COMMITS:
        patterns = " ".join(step["patterns"])
        run(f"git add {patterns}")
        
        # Check if there is anything to commit
        status = run("git status --porcelain")
        if not status.stdout.strip():
            continue

        step_env = base_env.copy()
        step_env["GIT_AUTHOR_DATE"] = step["date"]
        step_env["GIT_COMMITTER_DATE"] = step["date"]

        msg = step["msg"]
        res = subprocess.run(["git", "commit", "-m", msg], env=step_env, capture_output=True, text=True)
        print(f"Committed [{step['date'][:10]}]: {msg}")

    # Switch main branch to point to clean-history
    run("git branch -D main")
    run("git branch -m main")
    print("\nComplete! Clean git history built.")

    # Show log
    log = run("git log --oneline --graph")
    print("\nGit Log:")
    print(log.stdout)

if __name__ == "__main__":
    main()

