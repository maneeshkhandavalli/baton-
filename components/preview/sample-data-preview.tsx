"use client";

/**
 * Dev-only harness for /preview/sample-data. Renders the REAL SourcesStep and AddPointDialog with the REAL
 * CodeCell fixtures and duplicate guard. Only the network is simulated: "uploads" settle locally after a
 * moment and nothing is ever submitted to the server.
 */

import { FlaskConical, Plus } from "lucide-react";
import { useRef, useState } from "react";

import { HANDOVER_SECTIONS } from "@/components/handover/labels";
import { AddPointDialog } from "@/components/review/add-point-dialog";
import type { ManualPointForm } from "@/components/review/manual-point";
import { sampleForm } from "@/components/review/sample-point";
import { Button } from "@/components/ui/button";
import { blankSource, type DraftSource } from "@/components/wizard/draft-state";
import { SourcesStep } from "@/components/wizard/sources-step";
import { CODECELL_SAMPLE_POINTS, missingSampleSources } from "@/lib/prototype/sample-data/codecell";

const PREVIEW_HANDOVER_ID = "00000000-0000-4000-8000-000000000000";
const noop = () => {};

export function SampleDataPreview() {
  // One file of the user's own next to the samples, to check they never interfere with it.
  const [sources, setSources] = useState<DraftSource[]>(() => [
    blankSource({ localId: "own-1", name: "WhatsApp Chat with CodeCell Leads.txt", size: 3_412, kind: "whatsapp_export", status: "ready" }),
  ]);
  const [adding, setAdding] = useState(false);
  const busy = useRef(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogSample, setDialogSample] = useState<ManualPointForm | null>(null);

  function addSamples() {
    if (busy.current) return;
    busy.current = true;
    setAdding(true);
    const rows = missingSampleSources(sources.map((s) => s.name)).map((s) =>
      blankSource({ localId: `sample-${s.id}-${Date.now()}`, name: s.fileName, size: new TextEncoder().encode(s.content).length, kind: s.kind, status: "uploading", sample: true }),
    );
    setSources((list) => [...list, ...rows]);
    window.setTimeout(() => {
      setSources((list) => list.map((s) => (rows.some((r) => r.localId === s.localId) ? { ...s, status: "ready" } : s)));
      busy.current = false;
      setAdding(false);
    }, 700);
  }

  return (
    <div className="space-y-10">
      <section aria-labelledby="pv-sources" className="space-y-4">
        <h2 id="pv-sources" className="type-heading">
          Sources step
        </h2>
        <SourcesStep
          sources={sources}
          onFiles={noop}
          onRemove={(s) => setSources((list) => list.filter((x) => x.localId !== s.localId))}
          onRetry={noop}
          onDateOrder={noop}
          onSwitchKind={noop}
          full={sources.length >= 10}
          onUseSample={addSamples}
          addingSample={adding}
        />
      </section>

      <section aria-labelledby="pv-review" className="space-y-4">
        <h2 id="pv-review" className="type-heading">
          Review sections
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDialogSample(null);
              setDialogOpen(true);
            }}
          >
            <Plus aria-hidden="true" data-icon="inline-start" />
            Add a point
          </Button>
          {HANDOVER_SECTIONS.map((section) => (
            <Button
              key={section.id}
              size="sm"
              variant="ghost"
              aria-label={`Fill ${section.label} with sample data`}
              onClick={() => {
                const category = section.categories[0];
                setDialogSample(sampleForm(category, CODECELL_SAMPLE_POINTS[category]));
                setDialogOpen(true);
              }}
            >
              <FlaskConical aria-hidden="true" data-icon="inline-start" />
              {section.label}
            </Button>
          ))}
        </div>
        <AddPointDialog open={dialogOpen} onOpenChange={setDialogOpen} handoverId={PREVIEW_HANDOVER_ID} onCreated={noop} initialSample={dialogSample} />
      </section>
    </div>
  );
}
