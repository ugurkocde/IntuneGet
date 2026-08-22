#!/usr/bin/env bash
set -euo pipefail

source_name=${1:?icon source name is required}
commit_prefix=${2:?commit message prefix is required}

if [[ ! "$source_name" =~ ^[a-z0-9-]+$ ]]; then
  echo "Invalid icon source name: $source_name" >&2
  exit 1
fi
if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "A PAT-backed GH_TOKEN is required so pull-request checks are triggered" >&2
  exit 1
fi

git config --local user.email "github-actions[bot]@users.noreply.github.com"
git config --local user.name "github-actions[bot]"
git add public/icons/

if git diff --staged --quiet; then
  echo "No new icons to publish"
  echo "committed=false" >> "$GITHUB_OUTPUT"
  echo "committed_apps=" >> "$GITHUB_OUTPUT"
  exit 0
fi

committed_apps=$(git diff --staged --name-only \
  | awk -F/ '/^public\/icons\// && NF >= 3 { print $3 }' \
  | sort -u \
  | paste -sd, -)
icon_count=$(awk -F, '{ print NF }' <<< "$committed_apps")

# The workflow may have started from an earlier workflow_run SHA. Rebase the
# generated files onto the latest protected branch before opening the PR.
git stash push --include-untracked --message "generated-icon-changes-${GITHUB_RUN_ID}"
git fetch --no-tags origin main
branch="automation/icons-${source_name}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
git switch --create "$branch" origin/main
git stash pop
git add public/icons/
git commit -m "$commit_prefix for $icon_count apps"

push_url="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
git push "$push_url" "$branch"

pr_url=$(gh pr create \
  --base main \
  --head "$branch" \
  --title "$commit_prefix for $icon_count apps" \
  --body "Automated icon publication from workflow run [${GITHUB_RUN_ID}](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}).

The database is updated only after this PR passes required checks and merges.")

gh pr merge "$pr_url" --auto --squash --delete-branch

for _ in $(seq 1 180); do
  state=$(gh pr view "$pr_url" --json state --jq .state)
  if [[ "$state" == "MERGED" ]]; then
    {
      echo "committed=true"
      echo "committed_apps=$committed_apps"
      echo "pr_url=$pr_url"
    } >> "$GITHUB_OUTPUT"
    exit 0
  fi
  if [[ "$state" == "CLOSED" ]]; then
    echo "Icon publication PR closed without merging: $pr_url" >&2
    exit 1
  fi

  # Anything else merging to main while we wait puts the PR in BEHIND, which
  # blocks auto-merge when up-to-date branches are required. Update the branch
  # so auto-merge can proceed instead of stalling until the timeout.
  merge_state=$(gh pr view "$pr_url" --json mergeStateStatus --jq .mergeStateStatus 2>/dev/null || echo UNKNOWN)
  if [[ "$merge_state" == "BEHIND" || "$merge_state" == "DIRTY" ]]; then
    echo "Icon publication PR is $merge_state -- updating branch: $pr_url"
    gh pr update-branch "$pr_url" >/dev/null 2>&1 || true
  fi

  failed_checks=$(gh pr checks "$pr_url" --json bucket --jq '[.[] | select(.bucket == "fail" or .bucket == "cancel")] | length' 2>/dev/null || echo 0)
  if [[ "$failed_checks" -gt 0 ]]; then
    echo "Required checks failed for icon publication PR: $pr_url" >&2
    exit 1
  fi
  sleep 15
done

echo "Timed out waiting for icon publication PR to merge: $pr_url" >&2
exit 1
