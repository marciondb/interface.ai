import { z } from 'zod';

// discovery/catalogs/<product>.json. Envelope only: the content is validated by the catalog model.
export const OutcomeCatalogFileInSchema = z.looseObject({
  schemaVersion: z.literal(1),
});

export type OutcomeCatalogFileIn = z.infer<typeof OutcomeCatalogFileInSchema>;
