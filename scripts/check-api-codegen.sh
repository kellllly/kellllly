#!/bin/sh
set -eu

generated_paths="
lib/api-client-react/src/generated
lib/api-zod/src/generated
"

if ! git diff --quiet HEAD -- $generated_paths; then
  echo "Generated API files are out of date. Review the diff and commit the regenerated files." >&2
  git diff HEAD -- $generated_paths
  exit 1
fi

untracked_files=$(git ls-files --others --exclude-standard -- $generated_paths)
if [ -n "$untracked_files" ]; then
  echo "OpenAPI code generation created untracked files:" >&2
  printf '%s\n' "$untracked_files" >&2
  echo "Review and commit the generated files." >&2
  exit 1
fi

echo "Generated API files match the OpenAPI specification."
