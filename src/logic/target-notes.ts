import type { Candidate, TargetSpec } from '../models/capability';

// Why the element was addressed this way, as the synthesizer decided it.
export type TargetContext = {
  // The step reads the element's value, so its own text is record data.
  readonly read: boolean;
  readonly accessibleName: boolean;
};

const MARKUP_BOUND = "unique, but tied to this tenant's markup";

function primary(candidate: Candidate, context: TargetContext): string {
  switch (candidate.strategy) {
    case 'table_cell': {
      const located = `located by its row (${candidate.row.column} = ${candidate.row.equals}) and column header (${candidate.column})`;
      const subject = candidate.role === undefined ? `Cell ${located}` : `The ${candidate.role} in the cell ${located}`;
      return `${subject}, not by position or by its own text (record data), so it survives row reordering and works for any record.`;
    }
    case 'role':
      return `Matched first by accessible role and name (${candidate.role} "${candidate.name}"), which are stable across cosmetic markup changes.`;
    case 'label': {
      const label = `its visible label "${candidate.text}"`;
      if (context.read) return `The value is record data, so it is located by ${label}, never by its own text.`;
      if (!context.accessibleName) return `Field has no accessible name, so it is matched first by ${label}.`;
      return `Its accessible name is layout text rather than a handle, so it is matched first by ${label}.`;
    }
    case 'attribute': {
      const why = context.read ? 'The value is record data and has no usable label' : 'It has no usable accessible name or label';
      return `${why}, so it is matched by its ${candidate.name} attribute (${MARKUP_BOUND}).`;
    }
    case 'text':
      return `Matched by its visible text "${candidate.text}", which breaks if the wording changes.`;
    default: {
      const unhandled: never = candidate;
      return unhandled;
    }
  }
}

function fallback(candidate: Candidate): string {
  switch (candidate.strategy) {
    case 'table_cell':
      return `its row (${candidate.row.column} = ${candidate.row.equals}) and column header (${candidate.column})`;
    case 'role':
      return `accessible role and name (${candidate.role} "${candidate.name}")`;
    case 'label':
      return `visible label "${candidate.text}"`;
    case 'attribute':
      return `${candidate.name} attribute (${MARKUP_BOUND})`;
    case 'text':
      return `visible text "${candidate.text}" (breaks if the wording changes)`;
    default: {
      const unhandled: never = candidate;
      return unhandled;
    }
  }
}

// A reviewer-facing account of why the chain is robust and ordered as it is (RFC-002 `notes`).
// Deterministic: the same chain and context always give the same text.
export function targetNotes(spec: TargetSpec, context: TargetContext): string {
  const [first, ...rest] = spec.candidates;
  if (first === undefined) return '';
  const sentences = [primary(first, context)];
  if (rest.length > 0) sentences.push(`Fallbacks, in order: ${rest.map(fallback).join('; ')}.`);
  if (first.strategy !== 'table_cell' && spec.candidates.some((candidate) => JSON.stringify(candidate).includes('{{inputs.'))) {
    sentences.push('Parameterized by an input, so it follows the value replay is given.');
  }
  if (spec.frame !== undefined) sentences.push(`Searched only inside the ${spec.frame} frame.`);
  return sentences.join(' ');
}
