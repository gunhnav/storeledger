#!/usr/bin/env bash
# Script tiện ích quản lý Git Worktree đa phiên cho Claude Code
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

command="${1:-}"

usage() {
  echo "Cách dùng:"
  echo "  $0 add <branch-name> [dir-name]   # Tạo worktree mới và sao chép cấu hình"
  echo "  $0 list                           # Liệt kê các worktree hiện có"
  echo "  $0 remove <branch-or-dir>         # Xoá worktree an toàn"
  exit 1
}

case "$command" in
  add)
    branch="${2:-}"
    if [ -z "$branch" ]; then
      echo "Lỗi: Chưa nhập tên branch."
      usage
    fi
    safe_name=$(echo "$branch" | tr '/' '-')
    dir_name="${3:-../web-$safe_name}"

    echo "==> Tạo worktree tại: $dir_name (branch: $branch)"
    git worktree add -b "$branch" "$dir_name"

    # Sao chép file cấu hình được định nghĩa trong .worktreeinclude
    if [ -f "$ROOT_DIR/.worktreeinclude" ]; then
      echo "==> Sao chép file cấu hình theo .worktreeinclude:"
      while IFS= read -r file || [ -n "$file" ]; do
        file=$(echo "$file" | sed 's/#.*//' | xargs)
        if [ -n "$file" ] && [ -e "$ROOT_DIR/$file" ]; then
          mkdir -p "$(dirname "$dir_name/$file")"
          cp -r "$ROOT_DIR/$file" "$dir_name/$file"
          echo "    + Đã chép $file"
        fi
      done < "$ROOT_DIR/.worktreeinclude"
    fi

    echo "==> Hoàn tất! Di chuyển vào thư mục mới bằng lệnh:"
    echo "    cd \"$dir_name\" && yarn install"
    ;;

  list)
    git worktree list
    ;;

  remove)
    target="${2:-}"
    if [ -z "$target" ]; then
      echo "Lỗi: Chưa nhập tên branch hoặc thư mục cần xoá."
      usage
    fi
    safe_name=$(echo "$target" | tr '/' '-')
    dir_name="../web-$safe_name"
    if [ -d "$dir_name" ]; then
      git worktree remove "$dir_name"
      echo "==> Đã xoá worktree: $dir_name"
    else
      git worktree remove "$target"
      echo "==> Đã xoá worktree: $target"
    fi
    ;;

  *)
    usage
    ;;
esac
