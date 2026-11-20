"use client";

/**
 * Round 4 (Worker 02): the welcome shown once on first sign-in (and from Help → Welcome). Short: what Baton does,
 * what a handover is, the benefit, and what THIS person does next, by their real role. Two choices only: take the
 * guided tour, or explore on their own. Closing it any way counts as seen, so it never comes back by itself.
 */

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GuideRole } from "@/lib/onboarding/state";

import { useGuidance } from "./guidance";

interface Point {
  title: string;
  text: string;
}

export function welcomeCopy(
  role: GuideRole,
  opts: { tourAvailable: boolean; acknowledges: boolean },
): { lead: string; points: Point[]; tourLabel: string | null } {
  if (role === "incoming") {
    return {
      lead: "Someone has handed a role over to you. Baton keeps what they knew in one place, so you can start without guessing.",
      points: [
        {
          title: "A handover",
          text: "Decisions, owners, access, open work and risks, each linked to the message it came from.",
        },
        {
          title: "What to do",
          text: opts.acknowledges
            ? "Read it, start with your first 7 days, then acknowledge it so the team knows you have it."
            : "Read it and start with your first 7 days. Come back to it any time.",
        },
        {
          title: "What you see",
          text: "Only what your access level allows. Personal details were masked before anything was saved.",
        },
      ],
      tourLabel: opts.tourAvailable ? "Take the guided tour" : null,
    };
  }
  return {
    lead: "Baton turns a team's chats and documents into a handover the next person can trust, so knowledge doesn't leave with the person who leaves.",
    points: [
      {
        title: "A handover",
        text: "Decisions, owners, access, open work and risks of a role, each linked to the message it came from.",
      },
      {
        title: "How it works",
        text: "Add sources with consent, Baton drafts the points, you review them, invite the incoming person and publish.",
      },
      {
        title: "Privacy first",
        text: "Phone numbers, emails and payment details are masked before anything is saved, and nothing is shared until you publish.",
      },
    ],
    tourLabel: opts.tourAvailable ? "Take the guided tour" : null,
  };
}

export function WelcomeDialog() {
  const g = useGuidance();
  if (!g?.data) return null;
  const { data, welcomeOpen, closeWelcome, record, startTour } = g;
  const role = data.roles.primary;
  const steps = data.tours[role] ?? [];
  const acknowledges = steps.some((s) => s.id === "acknowledge");
  const copy = welcomeCopy(role, {
    tourAvailable: steps.length > 0,
    acknowledges,
  });

  const finish = () => {
    closeWelcome();
    record({ type: "welcome_seen" });
  };

  return (
    <Dialog
      open={welcomeOpen}
      onOpenChange={(open) => (open ? undefined : finish())}
    >
      <DialogContent className="sm:max-w-md" data-testid="welcome-dialog">
        <DialogHeader>
          <DialogTitle>
            {data.firstName
              ? `Welcome, ${data.firstName}`
              : role === "incoming"
                ? "Welcome to your handover"
                : "Welcome to Baton"}
          </DialogTitle>
          <DialogDescription>{copy.lead}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2.5">
          {copy.points.map((p) => (
            <li key={p.title} className="text-sm leading-relaxed">
              <span className="font-medium text-foreground">{p.title}. </span>
              <span className="text-muted-foreground">{p.text}</span>
            </li>
          ))}
        </ul>
        {!copy.tourLabel && role === "incoming" && (
          <p className="text-caption text-muted-foreground">
            Your handover isn&rsquo;t published yet. It will appear on your
            dashboard when the team publishes it.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" className="max-sm:h-10" onClick={finish}>
            {copy.tourLabel ? "Explore on my own" : "Got it"}
          </Button>
          {copy.tourLabel && (
            <Button
              autoFocus
              className="max-sm:h-10"
              onClick={() => {
                record({ type: "welcome_seen" });
                startTour(role);
              }}
            >
              {copy.tourLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
