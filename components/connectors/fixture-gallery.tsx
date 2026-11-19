"use client";

/** Dev-only gallery of the Connected channels panel (Main, Round 4 review): one scenario at a time, synthetic data. */

import { useMemo, useState } from "react";

import { ConnectorActionsProvider } from "./actions-context";
import { ConnectedChannels } from "./connected-channels";
import { createFixtureActions, FIXTURE_SCENARIOS, SCENARIO_TITLES, type FixtureScenario } from "./fixture-actions";

export function ConnectorFixtureGallery({ initial }: { initial: FixtureScenario }) {
  const [scenario, setScenario] = useState<FixtureScenario>(initial);
  const actions = useMemo(() => createFixtureActions(scenario), [scenario]);
  return (
    <div className="space-y-6 py-8">
      <div className="space-y-2">
        <h1 className="type-title">Connected channels · fixture preview</h1>
        <p className="text-sm text-muted-foreground">
          Synthetic data in this tab only. No provider, credential or database is used. Pick a state; every button works.
        </p>
        <div role="tablist" aria-label="Scenario" className="flex flex-wrap gap-2">
          {FIXTURE_SCENARIOS.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={s === scenario}
              onClick={() => {
                setScenario(s);
                window.history.replaceState(null, "", `?scenario=${s}`);
              }}
              className={`rounded-full border px-3 py-1 text-sm ${s === scenario ? "border-foreground bg-foreground text-background" : "border-border bg-card"}`}
            >
              {SCENARIO_TITLES[s]}
            </button>
          ))}
        </div>
      </div>
      <ConnectorActionsProvider key={scenario} actions={actions}>
        <section id="connectors" className="rounded-xl border border-border bg-card p-5">
          <ConnectedChannels handoverId="00000000-0000-4000-8000-000000000001" />
        </section>
      </ConnectorActionsProvider>
    </div>
  );
}
