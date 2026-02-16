# Contributing to IntuneGet

Thank you for your interest in contributing to IntuneGet.

## Contributor License Agreement (CLA)

IntuneGet is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).

Before your first pull request can be merged, you must sign the [Contributor License Agreement](CLA.md). This is a one-time requirement. The CLA lets you retain copyright to your contribution while granting the project maintainer the rights needed to distribute and sublicense the work.

**How to sign:** When you open a pull request, a bot will post a comment with instructions. Simply reply with the exact text:

> I have read the CLA Document and I hereby sign the CLA

After signing once, all your future PRs will pass the CLA check automatically.

If your contribution includes code from other sources, you must ensure that it is compatible with AGPL-3.0.

## Development Setup

```bash
git clone https://github.com/ugurkocde/IntuneGet.git
cd IntuneGet
npm install
cp .env.example .env.local
npm run dev
```

## Before Opening a PR

1. Create a focused branch from `main`.
2. Keep changes scoped to one problem or feature.
3. Run:

```bash
npm run lint
npm run test
npm run build
```

4. Update docs when behavior, env vars, or setup steps change.

## Pull Request Guidelines

1. Use a clear title and explain why the change is needed.
2. Include screenshots for UI changes.
3. Mention migration or breaking-change impact explicitly.
4. Link related issues when applicable.

## Reporting Bugs or Security Issues

- Bugs/feature requests: open a GitHub issue.
- Security concerns: follow `SECURITY.md`.
