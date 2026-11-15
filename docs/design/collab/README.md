# UI3 live collaboration space

This folder lives in the LEAD worktree (`.claude/worktrees/ui3-lead/docs/design/collab/`) so every agent sees the same
files in real time. Each agent writes ONLY inside its own folder; everyone reads everything.

```
collab/
  brand/      status.md, research notes, design-system drafts to share, responses to reviews
  shell/      status.md, audit.md, plan.md, review-*.md, requests.md
  handover/   status.md, audit.md, plan.md, review-*.md, requests.md
  demo/       status.md, audit.md, scenario.md, plan.md, review-*.md, requests.md
```

- `status.md`: what you are doing, blockers, what you need from whom. Keep it current.
- `requests.md`: change requests for files you do not own (who owns it, what, why).
- `review-<subject>.md`: your review of another agent's proposal or work.
- Message other agents directly with SendMessage (names: `brand`, `shell`, `handover`, `demo`; the lead is `main`) for
  anything time-sensitive, and leave a one-line note in your status file so the record survives.
- Screenshots: save under `<repo>/.claude/ui3/shots/<name>/` (git-ignored; third-party
  reference screenshots must never be committed, the repository is public).
