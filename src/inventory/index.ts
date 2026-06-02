/**
 * Inventory module public surface.
 *
 * Re-exports the search engine (searchProjects, queryInventory, affordabilityCeiling)
 * and the embedding composer (composeProjectEmbeddingText, embedProject) for use by:
 *   - src/agents/finder/tools.ts (03-04): searchProjects + queryInventory in tool execute()
 *   - src/inventory/crud.ts (03-04): embedProject on create/update
 *   - admin Server Actions: embedProject + queryInventory
 *
 * Core/shell rule: src/ must NOT import from app/ or next.
 */

export {
  searchProjects,
  queryInventory,
  affordabilityCeiling,
  DSR_MULTIPLE,
} from './search'

export type {
  ParsedCriteria,
  ProjectMatch,
  SearchResult,
  InventoryFilters,
} from './search'

export {
  composeProjectEmbeddingText,
  embedProject,
} from './embedText'
