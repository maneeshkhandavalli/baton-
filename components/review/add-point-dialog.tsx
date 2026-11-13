"use client";

import { useState } from "react";

import { attributeLabel, enumOptions } from "@/components/handover/attributes";
import { categoryLabel } from "@/components/handover/labels";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { createManualPoint } from "@/lib/actions/review";
import type { PointDetail } from "@/lib/contracts/dto";
import { ACCESS_LEVELS, POINT_CATEGORIES, type AccessLevel } from "@/lib/contracts/enums";

import { blankManualForm, buildManualPointInput, isPointCategory, MANUAL_FIELDS, type ManualPointForm } from "./manual-point";

const ACCESS_LABEL: Record<AccessLevel, string> = {
  everyone: "Everyone on the handover",
  leads_only: "Leads and reviewers only",
  reviewer_only: "Reviewers only",
};

interface AddPointDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  handoverId: string;
  onCreated: (point: PointDetail) => void;
}

/** P1-1: add knowledge the AI missed (createManualPoint, §11.3). Text is masked on the server. */
export function AddPointDialog({ open, onOpenChange, handoverId, onCreated }: AddPointDialogProps) {
  const { run, isPending } = useAction();
  return (
    <Dialog open={open} onOpenChange={(o) => !isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl">
        {open && (
          <AddPointBody
            handoverId={handoverId}
            pending={isPending}
            onCancel={() => onOpenChange(false)}
            onSubmit={async (input) => {
              const result = await run(() => createManualPoint(input), {
                success: "Point added. Review it like any other point.",
                onError: (e) => e.code === "validation_failed" && !!e.fieldErrors,
              });
              if (result.ok) {
                onCreated(result.data);
                onOpenChange(false);
              }
              return result.ok ? null : (result.error.fieldErrors ?? null);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddPointBody({
  handoverId,
  pending,
  onCancel,
  onSubmit,
}: {
  handoverId: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (input: Parameters<typeof createManualPoint>[0]) => Promise<Record<string, string[]> | null>;
}) {
  const [form, setForm] = useState<ManualPointForm>(() => blankManualForm());
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const set = (patch: Partial<ManualPointForm>) => setForm((f) => ({ ...f, ...patch }));
  const setField = (key: string, value: string) => setForm((f) => ({ ...f, fields: { ...f.fields, [key]: value } }));

  async function submit() {
    const built = buildManualPointInput(handoverId, form);
    if (!built.ok) {
      setErrors(built.fieldErrors);
      return;
    }
    setErrors({});
    const serverErrors = await onSubmit(built.input);
    if (serverErrors) setErrors(serverErrors);
  }

  const err = (key: string) =>
    errors[key]?.[0] ? (
      <p id={`${key}-error`} className="text-caption font-medium text-destructive-fg">
        {errors[key][0]}
      </p>
    ) : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a point</DialogTitle>
        <DialogDescription>
          Add something the incoming member needs that Baton didn&rsquo;t find. It starts as pending, like every other point, and is
          only published once approved.
        </DialogDescription>
      </DialogHeader>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="mp-category">Kind of point</Label>
          <NativeSelect
            id="mp-category"
            value={form.category}
            onChange={(e) => isPointCategory(e.target.value) && set({ category: e.target.value, fields: {} })}
          >
            {POINT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel[c]}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mp-title">Title</Label>
          <Input
            id="mp-title"
            value={form.title}
            maxLength={120}
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? "title-error" : undefined}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="e.g. Who holds the club bank login"
          />
          {err("title")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mp-statement">What the incoming member should know</Label>
          <Textarea
            id="mp-statement"
            value={form.statement}
            maxLength={1000}
            aria-invalid={!!errors.statement}
            aria-describedby={errors.statement ? "statement-error" : undefined}
            onChange={(e) => set({ statement: e.target.value })}
          />
          {err("statement")}
        </div>

        <fieldset className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
          <legend className="px-1 text-xs font-medium text-muted-foreground">{categoryLabel[form.category]} details</legend>
          {MANUAL_FIELDS[form.category].map((f) => {
            const id = `mp-attr-${f.key}`;
            const key = `attr.${f.key}`;
            const label = `${attributeLabel(f.key)}${f.required ? "" : " (optional)"}`;
            const value = form.fields[f.key] ?? "";
            const common = {
              id,
              "aria-invalid": !!errors[key],
              "aria-describedby": errors[key] ? `${key}-error` : undefined,
            };
            const options = f.kind === "enum" ? enumOptions(f.key) : null;
            return (
              <div key={f.key} className={f.kind === "list" ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
                <Label htmlFor={id}>{f.kind === "list" ? `${label}, comma-separated` : label}</Label>
                {options ? (
                  <NativeSelect {...common} value={value} onChange={(e) => setField(f.key, e.target.value)}>
                    <option value="">Not set</option>
                    {Object.entries(options).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input {...common} type={f.kind === "date" ? "date" : "text"} value={value} onChange={(e) => setField(f.key, e.target.value)} />
                )}
                {err(key)}
              </div>
            );
          })}
          {form.category === "contact" && (
            <p className="text-caption text-muted-foreground sm:col-span-2">
              Phone numbers and email addresses typed here are masked. Share direct contact details outside Baton.
            </p>
          )}
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="mp-testimony">How do you know this? (optional)</Label>
          <Textarea
            id="mp-testimony"
            value={form.testimony}
            maxLength={4000}
            aria-invalid={!!errors.testimony}
            aria-describedby="mp-testimony-hint"
            onChange={(e) => set({ testimony: e.target.value })}
            placeholder="e.g. I set this up with the bank in August."
          />
          <p id="mp-testimony-hint" className="text-caption text-muted-foreground">
            Saved as your own account, credited to you, so readers can see where it came from.
          </p>
          {err("testimony")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mp-access">Who can see it</Label>
          <NativeSelect
            id="mp-access"
            value={form.accessOverride ?? ""}
            onChange={(e) => set({ accessOverride: (ACCESS_LEVELS as readonly string[]).includes(e.target.value) ? (e.target.value as AccessLevel) : null })}
          >
            <option value="">Default for this handover</option>
            {ACCESS_LEVELS.map((a) => (
              <option key={a} value={a}>
                {ACCESS_LABEL[a]}
              </option>
            ))}
          </NativeSelect>
        </div>

        {err("form")}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {pending ? "Adding…" : "Add point"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
