#!/usr/bin/env python3
"""
HR FLOW — Universal Zero-Password Portable Packager (package_app.py)
Creates clean, self-contained standalone distribution bundles for Windows and Linux.
"""

import os
import sys
import zipfile
import tarfile

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
DIST_DIR = os.path.join(PROJECT_ROOT, "dist")

INCLUDE_DIRS = ["backend", "frontend", "data", "WorkFlow"]
INCLUDE_FILES = [
    "desktop_app.py",
    "install_linux.sh",
    "run_desktop.sh",
    "install_windows.bat",
    "run_desktop.bat",
    "HRFlow.vbs",
    "requirements.txt",
    "README.md",
]

EXCLUDE_PATTERNS = [
    "__pycache__",
    ".pyc",
    ".pytest_cache",
    ".git",
    ".venv",
    "venv",
    ".DS_Store",
    "dist",
    ".qodo",
]


def should_include(rel_path: str) -> bool:
    for pattern in EXCLUDE_PATTERNS:
        if pattern in rel_path.split(os.sep):
            return False
        if rel_path.endswith(pattern):
            return False
    return True


def build_windows_zip():
    os.makedirs(DIST_DIR, exist_ok=True)
    zip_path = os.path.join(DIST_DIR, "HRFlow_Windows_Portable.zip")
    print(f"📦 Packaging Windows distribution: {zip_path}...")

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname in INCLUDE_FILES:
            fpath = os.path.join(PROJECT_ROOT, fname)
            if os.path.isfile(fpath):
                zf.write(fpath, os.path.join("HRFlow", fname))

        for dname in INCLUDE_DIRS:
            dpath = os.path.join(PROJECT_ROOT, dname)
            if os.path.isdir(dpath):
                for root, _, files in os.walk(dpath):
                    for file in files:
                        full_path = os.path.join(root, file)
                        rel_path = os.path.relpath(full_path, PROJECT_ROOT)
                        if should_include(rel_path):
                            zf.write(full_path, os.path.join("HRFlow", rel_path))

    size_mb = round(os.path.getsize(zip_path) / (1024 * 1024), 2)
    print(f"✓ Windows Portable Bundle ready: {zip_path} ({size_mb} MB)")


def build_linux_tar():
    os.makedirs(DIST_DIR, exist_ok=True)
    tar_path = os.path.join(DIST_DIR, "HRFlow_Linux_Portable.tar.gz")
    print(f"📦 Packaging Linux distribution: {tar_path}...")

    with tarfile.open(tar_path, "w:gz") as tar:
        for fname in INCLUDE_FILES:
            fpath = os.path.join(PROJECT_ROOT, fname)
            if os.path.isfile(fpath):
                tar.add(fpath, arcname=os.path.join("HRFlow", fname))

        for dname in INCLUDE_DIRS:
            dpath = os.path.join(PROJECT_ROOT, dname)
            if os.path.isdir(dpath):
                for root, _, files in os.walk(dpath):
                    for file in files:
                        full_path = os.path.join(root, file)
                        rel_path = os.path.relpath(full_path, PROJECT_ROOT)
                        if should_include(rel_path):
                            tar.add(full_path, arcname=os.path.join("HRFlow", rel_path))

    size_mb = round(os.path.getsize(tar_path) / (1024 * 1024), 2)
    print(f"✓ Linux Portable Bundle ready: {tar_path} ({size_mb} MB)")


def main():
    print("=" * 60)
    print("  HR FLOW — STANDALONE PORTABLE PACKAGER")
    print("  [Zero-Password Universal Distribution]")
    print("=" * 60)
    build_windows_zip()
    build_linux_tar()
    print("\n🎉 All distribution packages created in ./dist/")


if __name__ == "__main__":
    main()

