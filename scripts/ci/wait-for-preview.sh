#!/usr/bin/env bash
# ==============================================================================
# scripts/ci/wait-for-preview.sh
#
# Waits until Vercel has deployed COMMIT_SHA and prints the preview origin (https://<host>).
# Writes preview_url=<origin> to $GITHUB_OUTPUT when running in GitHub Actions.
#
# Sources, in order:
#   1. A GitHub Deployment for the commit whose latest status is success with an environment_url
#      (only exists when the Vercel project's `deployment_status` events are enabled).
#   2. Otherwise, once the commit's "Vercel" commit status is success: the Vercel bot's PR comment metadata.
#      Its inspectorUrl must equal that commit status's target_url, which proves the comment describes this
#      commit's deployment; its previewUrl (the branch alias) is then used.
#
# The commit status target_url itself is never used as the preview: it is the vercel.com inspector page.
#
# Environment:
#   COMMIT_SHA           (default: git HEAD)
#   PR_NUMBER            (needed for source 2)
#   VERCEL_PROJECT_NAME  (default: bm-fixed-app-v7-1)
#   TIMEOUT_SECONDS      (default: 600)   POLL_INTERVAL (default: 10)
#   GH_TOKEN / GH_REPO   (required by gh in Actions)
# ==============================================================================

set -euo pipefail

COMMIT_SHA="${COMMIT_SHA:-$(git rev-parse HEAD)}"
PR_NUMBER="${PR_NUMBER:-}"
VERCEL_PROJECT_NAME="${VERCEL_PROJECT_NAME:-bm-fixed-app-v7-1}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-600}"
POLL_INTERVAL="${POLL_INTERVAL:-10}"

echo "Waiting for the Vercel preview of commit ${COMMIT_SHA} (timeout ${TIMEOUT_SECONDS}s)"

emit() {
  local origin="$1"
  echo "Found ready preview: ${origin}"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "preview_url=${origin}" >> "$GITHUB_OUTPUT"
  fi
  echo "${origin}"
  exit 0
}

# Source 1: GitHub Deployments created by Vercel (deployment_status events).
from_github_deployments() {
  local ids id status_json state url
  ids=$(gh api "repos/:owner/:repo/deployments?sha=${COMMIT_SHA}" --jq '.[].id' 2>/dev/null || true)
  for id in $ids; do
    status_json=$(gh api "repos/:owner/:repo/deployments/${id}/statuses" --jq '.[0] // empty' 2>/dev/null || true)
    [ -z "$status_json" ] && continue
    state=$(echo "$status_json" | jq -r '.state // empty')
    url=$(echo "$status_json" | jq -r '.environment_url // empty')
    if [ "$state" = "success" ] && [ -n "$url" ]; then
      echo "$url"
      return 0
    fi
  done
  return 1
}

# Source 2: the Vercel bot PR comment, verified against this commit's Vercel commit status.
from_pr_comment() {
  local inspector="$1" comment_id body payload preview
  [ -z "$PR_NUMBER" ] && return 1
  local ids
  if ! ids=$(gh api "repos/:owner/:repo/issues/${PR_NUMBER}/comments" --paginate \
    --jq '.[] | select(.user.login == "vercel[bot]") | .id' 2>&1); then
    # Most likely missing `pull-requests: read` / `issues: read` on the workflow token.
    echo "WARNING: cannot read PR #${PR_NUMBER} comments: ${ids}" >&2
    return 1
  fi
  comment_id=$(echo "$ids" | tail -n 1)
  [ -z "$comment_id" ] && return 1
  # The metadata is the first line of the comment body.
  body=$(gh api "repos/:owner/:repo/issues/comments/${comment_id}" --jq '.body // empty' 2>/dev/null | head -n 1 || true)
  [ -z "$body" ] && return 1
  payload=$(echo "$body" | sed -nE 's/^\[vc\]: #[^:]*:([A-Za-z0-9+\/=]+).*$/\1/p' | base64 -d 2>/dev/null || true)
  [ -z "$payload" ] && return 1
  preview=$(echo "$payload" | jq -r --arg name "$VERCEL_PROJECT_NAME" --arg inspector "$inspector" \
    '.projects[]? | select(.name == $name and .inspectorUrl == $inspector and .nextCommitStatus == "DEPLOYED") | .previewUrl // empty' \
    | head -n 1)
  [ -z "$preview" ] && return 1
  echo "https://${preview}"
}

START_TIME=$(date +%s)
while true; do
  ELAPSED=$(( $(date +%s) - START_TIME ))
  if [ "$ELAPSED" -ge "$TIMEOUT_SECONDS" ]; then
    echo "ERROR: Timed out after ${TIMEOUT_SECONDS}s waiting for the preview of ${COMMIT_SHA}." >&2
    exit 1
  fi

  if URL=$(from_github_deployments); then emit "$URL"; fi

  STATUS_JSON=$(gh api "repos/:owner/:repo/commits/${COMMIT_SHA}/statuses" \
    --jq '[.[] | select(.context == "Vercel")] | first // empty' 2>/dev/null || true)
  [ -z "$STATUS_JSON" ] && STATUS_JSON='{}'
  STATE=$(echo "$STATUS_JSON" | jq -r '.state // empty')
  INSPECTOR=$(echo "$STATUS_JSON" | jq -r '.target_url // empty')

  case "$STATE" in
    failure|error)
      echo "ERROR: Vercel reports the deployment of ${COMMIT_SHA} as ${STATE}: ${INSPECTOR}" >&2
      exit 1
      ;;
    success)
      if URL=$(from_pr_comment "$INSPECTOR"); then emit "$URL"; fi
      echo "Vercel deployment succeeded; waiting for its preview address (PR comment or GitHub Deployment)..."
      ;;
    *)
      echo "Vercel deployment not ready yet (state: ${STATE:-none}). Elapsed: ${ELAPSED}s."
      ;;
  esac
  sleep "$POLL_INTERVAL"
done
