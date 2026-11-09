#!/bin/sh
# Fails when a SARIF file holds a result whose rule has a security severity at
# or above the threshold (default 4.0, the CVSS floor of the specification).
# usage: sast-gate.sh <file.sarif> [threshold]
set -eu
SARIF="$1"
THRESHOLD="${2:-4.0}"
FINDINGS=$(jq -r --argjson min "$THRESHOLD" '
  .runs[] |
  ([.tool.driver.rules[]?, .tool.extensions[]?.rules[]?]
    | map({ key: .id, value: ((.properties["security-severity"] // "0") | tonumber) })
    | from_entries) as $severity |
  .results[]? |
  ($severity[.ruleId] // 0) as $score |
  select($score >= $min) |
  "\($score)\t\(.ruleId)\t\(.locations[0].physicalLocation.artifactLocation.uri // "?"):\(.locations[0].physicalLocation.region.startLine // "?")\t\(.message.text | split("\n")[0])"
' "$SARIF")
if [ -n "$FINDINGS" ]; then
  echo "Résultats SAST de sévérité >= $THRESHOLD :"
  printf '%s\n' "$FINDINGS"
  exit 1
fi
echo "Aucun résultat SAST de sévérité >= $THRESHOLD."
