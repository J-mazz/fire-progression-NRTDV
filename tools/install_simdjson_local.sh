#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

install_root="$PWD/.tools/simdjson"
rpm_dir="$install_root/rpms"
root_dir="$install_root/root"

for command in dnf rpm2cpio cpio; do
  command -v "$command" >/dev/null || {
    echo "Required command not found: $command" >&2
    exit 1
  }
done

rm -rf "$rpm_dir" "$root_dir"
mkdir -p "$rpm_dir" "$root_dir"
dnf download --destdir "$rpm_dir" --arch x86_64 simdjson simdjson-devel

for package in "$rpm_dir"/*.rpm; do
  (
    cd "$root_dir"
    rpm2cpio "$package" | cpio -idm --quiet
  )
done

{
  echo "Installed project-local simdjson packages:"
  for package in "$rpm_dir"/*.rpm; do
    rpm -qp --queryformat '%{NAME} %{VERSION}-%{RELEASE}.%{ARCH}\n' "$package"
  done
} > "$install_root/VERSION"

cat "$install_root/VERSION"
echo "SIMDJSON_ROOT=$root_dir/usr"
