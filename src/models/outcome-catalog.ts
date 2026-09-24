import { z } from 'zod';
import { OutcomeSchema, predicateTarget, TargetNameSchema, TargetSpecSchema, type Outcome } from './capability';

// Outcomes known for one app, written from its visible texts; discovery copies the ones a
// request lists instead of guessing them (RFC-003). `targets` holds the recovery controls.
export const OutcomeCatalogSchema = z
  .strictObject({
    product: z.string().min(1),
    targets: z.record(TargetNameSchema, TargetSpecSchema),
    outcomes: z.array(OutcomeSchema),
  })
  .superRefine((catalog, ctx) => {
    const ids = new Set<string>();
    catalog.outcomes.forEach((outcome, index) => {
      if (ids.has(outcome.id)) ctx.addIssue({ code: 'custom', path: ['outcomes', index, 'id'], message: `duplicate outcome id ${outcome.id}` });
      ids.add(outcome.id);
      for (const target of outcomeTargets(outcome)) {
        if (!Object.hasOwn(catalog.targets, target)) ctx.addIssue({ code: 'custom', path: ['outcomes', index], message: `unknown target ${target}` });
      }
    });
  });

// Targets an outcome's detector and recovery refer to.
export function outcomeTargets(outcome: Outcome): string[] {
  const detector = predicateTarget(outcome.when);
  const recovery = outcome.kind === 'recoverable' ? outcome.recover?.target : undefined;
  return [...new Set([detector, recovery].filter((target) => target !== undefined))];
}

export type OutcomeCatalog = z.infer<typeof OutcomeCatalogSchema>;
