# Private Linux runtime checks

The manual **Linux runtime rehearsal** workflow runs one standard Ubuntu24.04 x64 job. It has no push, pull-request or scheduled trigger, deploy step or provider secret. Its45minute timeout bounds runner time; it does not establish an account spending limit. Check the repository owner's current included compute allowance immediately before starting it. The required confirmation input is an administrator assertion, not a billing API check.

The workflow uses pinned checkout/setup-node actions, reviewed immutable pyenv/pyenv-virtualenv commits, Node24.22.1, Python3.12.16 and Poetry2.5.1. It creates the named `/home/runner/.pyenv/versions/.victoria-hardware` environment and installs the committed npm/Poetry lockfiles. Existing pyenv is never overwritten. Runner free disk must be at least5GiB before and after installation; the bootstrap performs no cleanup to manufacture capacity. No dependency cache or artifact is uploaded, and checkout credentials are not persisted. Receipts remain in the private run logs and summary.

## What the job verifies

- Normal typecheck and production build, followed by the preflight requiring actual Linux x64.
- Worker cancellation, timeout, descendant-process handling, queue admission, database reopen and stopped-source snapshot regressions.
- Reopened exact exports for all six examples, a numerical cantilever oracle and unsupported-input check, and measured STEP reconstruction with real hole resizing and unsupported-geometry refusal.
- Real application jobs against new disposable data: a revised component CAD package, strength study, measured STEP import/reconstruction/acceptance and a600-frame20second1920×1080 product MP4.
- Every application/worker in that disposable runtime closes before snapshot. The original temporary data is then removed, a new location restored, and authorized CAD/STEP/MP4 downloads checked byte-for-byte. Revision/history, the study's input hash and a saved note are retained; anonymous package download remains forbidden.

The workload script reports actual source commit/dirty status, platform, hashes, elapsed time, temporary output bytes and sampled process-tree memory/disk. Memory is a one-second RSS sum: shared pages may be double-counted and short peaks missed. A ready status without validated bytes is not accepted. Temporary designs and files are removed after verification; no personal development database is used. Browser clips are generated through the ordinary application renderer, not supplied fixtures.

On the default GitHub checkout, the entry points are `/home/runner/work/hardware-studio/hardware-studio/scripts/linux-rehearsal-bootstrap.sh`, `/home/runner/work/hardware-studio/hardware-studio/scripts/runtime-preflight.mjs` and `/home/runner/work/hardware-studio/hardware-studio/scripts/runtime-workloads.ts`. The existing local named environment can exercise the workload script without the Linux flag:

```sh
cd /opt/hardware-studio
export VIRTUAL_ENV="$(pyenv root)/versions/.victoria-hardware"
export PATH="$VIRTUAL_ENV/bin:$PATH"
export CAD_PYTHON="$VIRTUAL_ENV/bin/python"
OPENAI_API_KEY='' AI_BUDGET_USD=0 npx --no-install tsx /opt/hardware-studio/scripts/runtime-workloads.ts
```

A macOS pass verifies the script/application paths locally, not Linux. An Actions pass verifies that ephemeral runner only: it does not establish the final server's systemd configuration, persistent-volume capacity, backups, native redistribution notices, public HTTPS/WebSockets, two-browser Notes, uptime or real microphone/physical fabrication. Review the actual run conclusion and every step; a skipped confirmation job is not a pass. Run logs contain sanitized evidence rather than downloadable product files. The host procedure remains `/opt/hardware-studio/docs/RELEASE-REHEARSAL.md`.

Workflow behavior follows GitHub's [manual workflow dispatch](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow), [workflow permissions and limits](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) and [private-runner billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions). The manual workflow must exist on the default branch before GitHub exposes its dispatch control. No workflow execution or deployment is implied by this recipe.
