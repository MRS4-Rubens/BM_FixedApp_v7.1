#!/usr/bin/env bash
# ==============================================================================
# scripts/ci/wait-for-preview.sh
#
# Polls GitHub API or Vercel API for a ready preview deployment URL for the commit.
# Exits with 0 and writes preview_url to $GITHUB_OUTPUT and stdout on success.
# Exits with 1 on timeout or deployment failure.
#
# Usage:
#   ./scripts/ci/wait-for-preview.sh
#
# Environment variables:
#   COMMIT_SHA       (optional, defaults to current HEAD)
#   TIMEOUT_SECONDS  (optional, defaults to 600)
#   POLL_INTERVAL    (optional, defaults to 10)
#   GITHUB_OUTPUT    (optional, standard GitHub Actions output path)
# ==============================================================================

set -euo pipefail

COMMIT_SHA="${COMMIT_SHA:-$(git rev-parse HEAD)}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-600}"
POLL_INTERVAL="${POLL_INTERVAL:-10}"

echo "Waiting for preview deployment for commit: ${COMMIT_SHA}"
echo "Timeout: ${TIMEOUT_SECONDS}s, polling every ${POLL_INTERVAL}s"

START_TIME=$(date +%s)

while true; do
  CURRENT_TIME=$(date +%s)
  ELAPSED=$((CURRENT_TIME - START_TIME))

  if [ "$ELAPSED" -ge "$TIMEOUT_SECONDS" ]; then
    echo "ERROR: Timed out after ${TIMEOUT_SECONDS} seconds waiting for preview deployment." >&2
    exit 1
  fi

  # Attempt 1: Fetch deployment via GitHub CLI (gh) deployments / commit statuses
  DEPLOY_URL=""
  DEPLOY_STATE=""

  if command -v gh >/dev/null 2>&1; then
    # Look for deployment status on the commit
    DEPLOY_STATUS_JSON=$(gh api "repos/:owner/:repo/deployments?sha=${COMMIT_SHA}" --jq '.[0]' 2>/dev/null || echo "")

    if [ -n "$DEPLOY_STATUS_JSON" ] && [ "$DEPLOY_STATUS_JSON" != "null" ]; then
      DEPLOY_ID=$(echo "$DEPLOY_STATUS_JSON" | jq -r '.id // empty')
      if [ -n "$DEPLOY_ID" ]; then
        LATEST_STATUS=$(gh api "repos/:owner/:repo/deployments/${DEPLOY_ID}/statuses" --jq '.[0]' 2>/dev/null || echo "")
        DEPLOY_STATE=$(echo "$LATEST_STATUS" | jq -r '.state // empty')
        DEPLOY_URL=$(echo "$LATEST_STATUS" | jq -r '.environment_url // .target_url // empty')
      fi
    fi

    # Fallback to commit status checks (Vercel sets status context 'Vercel')
    if [ -z "$DEPLOY_URL" ]; then
      STATUSES_JSON=$(gh api "repos/:owner/:repo/commits/${COMMIT_SHA}/statuses" --jq '.[] | select(.context | test("(?i)vercel"))' 2>/dev/null || echo "")
      if [ -n "$STATUSES_JSON" ]; then
        STATUS_STATE=$(echo "$STATUSES_JSON" | jq -r '.state // empty' | head -n 1)
        TARGET_URL=$(echo "$STATUSES_JSON" | jq -r '.target_url // empty' | head -n 1)
        if [ "$STATUS_STATE" = "success" ] && [ -n "$TARGET_URL" ]; then
          DEPLOY_STATE="success"
          DEPLOY_URL="$TARGET_URL"
        elif [ "$STATUS_STATE" = "failure" ] || [ "$STATUS_STATE" = "error" ]; then
          echo "ERROR: Commit status indicates deployment failure: ${STATUS_STATE}" >&2
          exit 1
        fi
      fi
    fi
  fi

  if [ "$DEPLOY_STATE" = "success" ] && [ -n "$DEPLOY_URL" ]; then
    echo "Found ready deployment: ${DEPLOY_URL}"
    if [ -n "${GITHUB_OUTPUT:-}" ]; then
      echo "preview_url=${DEPLOY_URL}" >> "$GITHUB_OUTPUT"
    fi
    echo "${DEPLOY_URL}"
    exit 0
  fi

  if [ "$DEPLOY_STATE" = "failure" ] || [ "$DEPLOY_STATE" = "error" ]; then
    echo "ERROR: Deployment failed with state: ${DEPLOY_STATE}" >&2
    exit 1
  fi

  echo "Deployment not ready yet (state: ${DEPLOY_STATE:-pending}). Elapsed: ${ELAPSED}s. Sleeping ${POLL_INTERVAL}s..."
  sleep "$POLL_INTERVAL"
done

