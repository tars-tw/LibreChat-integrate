# CI/CD policy — `release/26P3_dev`

This repository is a fork of upstream LibreChat wrapped around the pwc_tars
platform. Upstream's workflow set is tuned for `danny-avila/LibreChat`: it
publishes npm packages, releases Helm charts, runs a code-index droplet, and
gates on hygiene heuristics that assume no downstream customisation. Most of
that either cannot succeed here (missing secrets, hard-coded repo names) or
reports constantly against TARS-only code.

`release/26P3_dev` is our integration branch and the base for every feature PR,
so the CI it runs is defined here — deliberately **not** the same set upstream
runs on `main`.

## Guiding rule

A check stays blocking only if it can fail for a reason we would actually fix.
Everything else is either non-blocking, manual-dispatch, or deleted.

## What runs on a PR into `release/26P3_dev`

| Workflow | Gates the PR | What it protects |
|---|---|---|
| `static-checks.yml` | ✅ | ESLint, Prettier, import sorting (changed files only), ESLint-config regression sweep, config-migration tests |
| `backend-review.yml` | ✅ | Package builds, TypeScript typecheck (`data-provider`, `data-schemas`, `@librechat/api`, `@librechat/client`), circular-dependency detection, Jest for `api` (3 shards), `data-provider`, `data-schemas`, `@librechat/api` (4 shards) |
| `frontend-review.yml` | ✅ | Package builds, `tsc --noEmit` on `client`, client Jest suite |
| `agents-integration-tests.yml` | ✅ | Agent integration tests against in-process MongoDB |
| `cache-integration-tests.yml` | ✅ | Integration tests against a real Redis |
| `langfuse-fanout.yml` | ✅ | Only fires when `otel/langfuse-fanout/**` changes |

These are the "程式碼檢查" layer and they stay. Every hard failure we have hit
so far came from this layer and was a genuine defect in our own TARS code
(missing locale keys, a missing `aria-labelledby`, a `data-schemas` type that
was not extended alongside its schema). Do not weaken them.

## Required status checks and rulesets

Goal: repository admins may bypass the "one approving review" requirement, but
**not** the checks. Classic branch protection cannot express that — its
`Do not allow bypassing the above settings` toggle is all-or-nothing. Rulesets
can, because a bypass list applies only to the ruleset that carries it, and
several rulesets can target the same branch and are evaluated together.

| Ruleset | Rules | Bypass list |
|---|---|---|
| **A — Review** | Require a pull request; required approvals = 1 | Repository admin |
| **B — Checks** | Require status checks to pass | *(empty)* |

Verify the result under `Settings → Rules → Rule insights`, which records who
bypassed which ruleset on each merge.

### Why `static-checks.yml` has no `paths:` filter

A required status check that **never reports** leaves a PR stuck on
`Expected — waiting for status to be reported`, unmergeable by anyone — including
admins, since ruleset B has no bypass list. That is exactly what a `paths:`
filter produces: the workflow does not start, so no check run is ever created.

The distinction that matters:

- a workflow skipped by `paths:` → **no check run** → the PR blocks forever
- a job or step skipped by `if:` → check run with conclusion `skipped` → GitHub
  counts it as **passing**

So `static-checks.yml` triggers on every pull request, and its per-check path
detection lives in the `Detect affected checks` step (`dorny/paths-filter`)
instead. A docs-only PR now reaches the job, skips every check, skips the
dependency install via the `Decide whether dependencies are needed` gate, and
reports success in seconds. Verified locally against the summarize script: all
steps skipped → `All affected static checks passed.`, exit 0.

`Static checks` is therefore safe to add to ruleset B today.

### Before requiring anything else

`backend-review.yml`, `frontend-review.yml`, and both integration workflows still
carry `paths:` filters, so they are **not** safe as required checks yet — a
docs-only PR would deadlock on them. Requiring them means first restructuring
each one the same way: drop the trigger filter, add a paths-filter job, and gate
the downstream jobs with `if:` so they report `skipped` rather than nothing.

Their check names, once that is done:

```
Build packages                     (defined in BOTH backend-review and frontend-review)
TypeScript type checks
TypeScript type checks (client)
Circular dependency checks
Tests: api (shard 1/3 … 3/3)
Tests: data-provider
Tests: data-schemas
Tests: @librechat/api (shard 1/4 … 4/4)
Tests: Ubuntu
Integration Tests that use in-process MongoDB
Integration Tests that use actual Redis Cache
```

Do not enable `Require branches to be up to date before merging` — every new
commit on the base would re-run all sixteen checks.

## Checks removed from `static-checks.yml`

Two upstream-hygiene sweeps were deleted outright. They were first downgraded to
warnings, but they were also the workflow's two dominant costs — between them
they were the bulk of its runtime — and a non-blocking check nobody reads is not
worth paying for.

- **Unused i18next keys** — greps the whole source tree once per translation key,
  ~2,400 keys. This fork adds `com_ui_tars_*` keys ahead of the screens that
  consume them, so it reported constantly.
- **depcheck / unused npm packages** — installed depcheck globally, then ran a
  chain of dependency-extraction steps plus three depcheck passes (root, client,
  api). TARS-only dependencies are reached through thin `/api` wrappers and
  dynamic config, which depcheck cannot see.

Deleting these took the workflow from 831 lines / 32 steps to 402 lines /
20 steps. What remains is the layer that actually catches our defects: ESLint,
Prettier, import sorting, the ESLint-config regression sweep, and the
config-migration tests.

If unused locale keys or stale dependencies ever need auditing, run the tools
locally on demand — that is the right cadence for a hygiene sweep, not once per
push.

## Manual dispatch only

| Workflow | Why it is not on PRs |
|---|---|
| `playwright-bombadil.yml` | Randomised 30-minute exploration run. It already carried `continue-on-error`, so it never gated anything — it only consumed runner time on every push. Dispatch it when touching chat streaming, forking, or steering. |
| `docker-smoke.yml` | ~25-minute multi-stage Docker build that answers only "does the image still build". Dispatch it before cutting an image. |

## Image / deploy workflows (unchanged)

`dev-images.yml`, `dev-branch-images.yml`, `dev-staging-images.yml`,
`main-image-workflow.yml`, `tag-images.yml`, `deploy-dev.yml`, and
`retry-docker-builds.yml` trigger on `push` to `main`/`dev`, on tags, or on
manual dispatch. They never fire on a `release/26P3_dev` PR, so they were left
alone. Revisit them when the image-publishing story for this fork is settled.

## Deleted workflows

Removed because they can only succeed in `danny-avila/LibreChat`, or because
they burn schedule time for a signal we do not consume:

| Removed | Reason |
|---|---|
| `a11y.yml` | Job body is gated on `head.repo.full_name == 'danny-avila/LibreChat'`; it was already a permanent no-op, and needs `AXE_LINTER_API_KEY`. |
| `gitnexus-index.yml`, `gitnexus-deploy.yml`, `gitnexus-cleanup-pr.yml`, `gitnexus-pr-command.yml` | Upstream's code-index droplet. Needs `GITNEXUS_DO_*` SSH secrets and `HF_TOKEN`. `gitnexus-cleanup-pr` fired on every PR close and failed. |
| `client.yml`, `data-provider.yml`, `data-schemas.yml` | npm publish of `@librechat/*` packages. We consume these workspaces locally and never publish them. |
| `helmcharts.yml`, `sync-helm-chart-tags.yml` | Upstream Helm chart release pipeline. |
| `build.yml`, `deploy.yml` | Provision an Azure ACI self-hosted runner, hard-coded to `GH_REPOSITORY: 'LibreChat'`. |
| `locize-i18n-sync.yml` | Syncs translations with upstream's Locize project. |
| `frontend-windows-nightly.yml` | Nightly Windows Jest run. We ship Linux containers; it only produced a daily red run. |

### What happens on the next upstream rebase

We track upstream on `main` and rebase `release/26P3_dev` onto it, so the commit
that removes these files is replayed on top of the new upstream tree. Three
cases:

1. **Upstream did not touch the file** — replays cleanly, the file stays deleted.
   Nothing to do. This is the common case.
2. **Upstream modified the file** — `git` reports
   `CONFLICT (modify/delete): <file> deleted in <our commit> and modified in HEAD`.
   Resolve by keeping our decision:
   ```bash
   git rm .github/workflows/<file>.yml
   git rebase --continue
   ```
3. **Upstream added a *new* workflow** — it arrives untouched by our commit and
   will start running on our PRs. This is the case that actually needs
   attention: after each upstream rebase, `ls .github/workflows/` and check
   whether anything new fires on `pull_request`. Apply the guiding rule above.

The files do not silently come back. Nothing here is lost by rebasing — it just
occasionally asks you to reconfirm the deletion.

## Log noise that is not a failure

CI logs contain a lot of `console.log` / `console.warn` output from the suites
themselves — for example:

```
error: [RedisEventTransport] Failed to publish done: Generation DONE publication was fenced by a replacement
console.warn Content type mismatch { existingType: 'think', contentType: 'text', index: 0 }
[ResumableSSE] Effect triggered { ... }
```

These are tests deliberately exercising error and race paths and asserting the
resulting behaviour. They appear under `PASS` suites. Read the `Tests:` summary
line and the `::error::` annotations, not the raw log volume.

## Runner-image apt failures (`packages.microsoft.com` 403)

`cache-integration-tests.yml` installs `redis-server` with apt. GitHub-hosted
runner images preconfigure Microsoft's apt repositories (`azure-cli` and
`packages.microsoft.com/ubuntu/24.04/prod`), which periodically answer
`403 Forbidden`. A single unreachable repository fails the whole `apt-get update`
with exit 100, so the job dies for a reason that has nothing to do with the PR:

```
E: Failed to fetch https://packages.microsoft.com/repos/azure-cli/dists/noble/InRelease  403  Forbidden
E: The repository 'https://packages.microsoft.com/repos/azure-cli noble InRelease' is no longer signed.
Error: Process completed with exit code 100.
```

We never use those repositories, so the install step now removes them before
updating:

```bash
sudo rm -f /etc/apt/sources.list.d/*microsoft* /etc/apt/sources.list.d/*azure-cli*
```

The glob covers both the `.list` and deb822 `.sources` naming the images have
used, and `rm -f` is a no-op when nothing matches. This is a deterministic fix
rather than a retry — the repositories are simply not needed.

`playwright-bombadil.yml` runs `npx playwright install-deps chrome`, which shells
out to apt and can hit the same 403. It is manual-dispatch only, so it was left
alone; if a dispatched run fails this way, apply the same `rm -f` line before it.

## The ESLint full-sweep gate, and why it stopped firing

`static-checks.yml` carries an ESLint regression gate that lints `api client
packages` **twice** — once under the PR's `eslint.config.mjs` and once under the
base ref's — then fails if the new config stops covering files the old one linted
or produces new diagnostics. It is the only way to catch a mis-scoped `ignores`
or a silently disabled rule, because the normal changed-files lint would pass
vacuously on a config-only PR.

It also costs ~13 minutes, which was the whole of a 15m22s `Static checks` run.

The trigger was too broad. Its filter was:

```yaml
eslint_config:
  - 'eslint.config.mjs'
  - '.github/workflows/static-checks.yml'   # ← removed
```

Editing this workflow file cannot change what ESLint reports, so every PR that
touched the CI config paid the full double sweep for no signal — including the PR
that introduced this document. The filter is now `eslint.config.mjs` only.

Effect: `Static checks` drops to roughly two minutes on an ordinary PR, and the
sweep still runs in full on the rare PR that actually edits the ESLint config,
which is exactly when it is worth 13 minutes.

If it ever needs to be faster on that path, the two sweeps are independent and
could run concurrently — roughly halving it. Not done: it would restructure a
script that runs a few times a year, for no benefit on any other PR.

## Fixed sleeps are the recurring flake pattern

Two `data-schemas` failures so far had the same shape: a test that does the work,
then waits a **fixed number of milliseconds**, then asserts. A delay tuned on a
developer machine is not a delay; on a loaded runner the awaited thing simply has
not happened yet, and the assertion fails for a reason unrelated to the change.

`src/models/plugins/mongoMeili.findOneAndUpdate.spec.ts` →
`persists the _meiliIndex flag after indexing via the wrapper` failed with
`_meiliIndex` `false` instead of `true`. The `_meiliIndex` write-back is a second
async step after `addDocuments` resolves and is observable only through the
collection, so the test slept `50ms` and hoped. Replaced with a `waitFor`
predicate poll that returns as soon as the flag lands — the test now finishes in
~4ms instead of always paying 50ms, and cannot outrun a slow runner. The existing
`waitForMock` helper was refactored onto the same primitive.

The `skips re-indexing when the title already matches` test in that file had the
same exposure on its positive `mockGetDocument` assertion and was converted too.

Left alone deliberately: sleeps that precede a **purely negative** assertion
(`expect(mock).not.toHaveBeenCalled()`). There is nothing to poll for when the
expected outcome is "nothing happens", and a short wait there can only
under-detect, never fail spuriously.

**When a test needs to wait, wait for the condition, not for the clock.** If you
add a `setTimeout`-based sleep before an assertion, expect it to fail in CI
eventually.

See also the `userGroup.spec.ts` entry below — same root cause, different
mechanism.

## Known flakiness in the `api` Jest suite

The `api` workspace has cross-file `process.env` and module-registry pollution.
Jest reuses a worker process across test files, so a file that mutates
`process.env` without restoring it changes the behaviour of whatever runs next
in that worker. `backend-review.yml` splits the suite with `--shard=N/3`, which
changes *which* files share a worker, so the set of failing tests moves between
runs.

Observed locally on a clean tree (two consecutive full runs of `api`):

- run 1 — 33 failures, including `server/services/AuthService.spec.js`
- run 2 — 13 failures, `AuthService.spec.js` green

`server/routes/__tests__/config.spec.js` is a known participant: whether
`analyticsGtmId` leaks into the unauthenticated payload depends on what an
earlier file left in `process.env`.

Practical rule: **a single red `api` shard is not automatically a real
regression.** Re-run the shard, and if it moves, it is pollution. Reproduce a
suspected real failure by running the one file (`cd api && npx jest <path>`).
Fixing this properly means auditing the offending specs for `process.env`
save/restore in `beforeEach`/`afterEach` — worth doing, but it is upstream test
code and a separate piece of work.

Separately, `server/routes/agents/__tests__/responses.spec.js` (upstream Open
Responses API integration test) fails 12/17 reproducibly in isolation. It fails
identically on `main`, so it is inherited from upstream, not caused by the TARS
integration.

### `data-schemas`: `userGroup.spec.ts` concurrency tests — fixed, not flaked away

`src/methods/userGroup.spec.ts` →
`getUserPrincipals caching › deduplicates concurrent cache builds for the same member key`
failed intermittently in CI with `cache.set` called 2 times instead of 1.

The product code was never at fault: `getMemberGroupIds` registers its in-flight
lookup in `pendingGroupLookups` synchronously after the pending check, so
concurrent same-process callers always coalesce. The *test* was timing-dependent.
Its fake `cache.get` awaited a per-caller `setTimeout(10)`, and the assertion
assumed all three callers would resume in the same timer batch. Under CI load
(2 workers plus coverage instrumentation) one timer callback can be starved past
the point where the first caller has finished its database query and cleared its
pending entry — so the late caller legitimately starts a second build.

Replaced the per-caller timer with `createConcurrentMissGate(n)`: a `cache.get`
that releases every caller on a **single** promise resolution. All three
continuations then drain in the same microtask turn and reach the dedup check
before the first build's `await` on the database — which is real I/O, a macrotask
— can possibly resolve. Every caller walks an identical number of microtask hops,
so the ordering is fixed rather than probabilistic. No timers, no sleep, and the
test now asserts the same thing it always meant to.

Applied to both concurrency tests in that describe block (the dedup test and
`shares one lock and DB build across concurrent same-process callers`, which had
the same pattern and the same exposure).

Verified: 6 concurrent jest processes of the spec, all green; the full workspace
suite at 58 suites / 1982 tests.

This edits an upstream spec, so expect a conflict if upstream ever touches those
two tests. Keep our version — the timer-based original is the flaky one.

Local runs need the same fixtures CI creates, or you get spurious failures:

```bash
mkdir -p api/data && echo '{}' > api/data/auth.json
cp api/test/.env.test.example api/test/.env.test
```

Both paths are gitignored.

## Keeping `static-checks` green locally

Import-order and Prettier drift is caught by a `lint-staged` pre-commit hook,
but nothing installed that hook: the root `package.json` had no `prepare`
script, so `.husky/pre-commit` was never wired into `.git`. It now does
(`"prepare": "husky || true"`), which runs automatically on `npm install` /
`npm ci`.

If you cloned before that change, install it once:

```bash
npm run prepare
```

Verify with `git config core.hooksPath` — it should print `.husky/_`. Do not
commit with `--no-verify`.

Note that the repository as a whole has pre-existing import-order drift in
upstream files. That is fine: the CI check diffs against the PR base and only
inspects files your branch touched. Never run a repo-wide `npm run sort-imports`
— it would rewrite ~200 upstream files and wreck the next upstream merge.
