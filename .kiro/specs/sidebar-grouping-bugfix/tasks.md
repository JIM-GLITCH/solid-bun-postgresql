# Implementation Tasks

## Phase 1: Requirements (Completed)

- [x] Document current behavior defects
- [x] Document expected behavior
- [x] Document unchanged behavior for regression prevention

## Phase 2: Design (Completed)

- [x] Create bug condition methodology documentation
- [x] Design implementation approach
- [x] Define testing strategy

## Phase 3: Implementation

### Task 1: Add Delete Group UI (Already Done)
- [x] `deleteGroup(groupName)` exists in `connection-storage.ts`
- [x] `connections/delete-group` endpoint exists in backend
- [x] `handleMenuAction("deleteGroup")` case exists in `sidebar.tsx`
- [x] "删除分组" menu item exists in context menu JSX

### Task 2: Fix Drag-and-Drop Reordering
- [ ] Add `connections/reorder` API method to `shared/src/transport.ts`
- [ ] Add `reorderConnections(list)` function to `connection-storage.ts` (frontend)
- [ ] Add `reorderConnections(list)` handler to `backend/connections-store.ts`
- [ ] Register `connections/reorder` in `backend/api-core.ts` handler
- [ ] Register route in `backend/api-handlers-http.ts` and `api-handlers-vscode.ts`
- [ ] Fix `reorderConnectionsInGroup` in `sidebar.tsx` to use new reorder API
- [ ] Fix cross-group drop: build new full list in memory, then call reorder API once

### Task 3: Fix Connection Duplication on Cross-Group Move
- [ ] Audit `handleDrop` in `sidebar.tsx` — ensure source group removal happens before target insert
- [ ] Replace sequential `updateStoredConnectionMeta` + `reorderConnectionsInGroup` with single atomic `reorderConnections` call
- [ ] Verify no duplicate entries after drop by checking backend `reorderConnections` replaces full list

### Task 4: Visual Drop Indicator Position
- [ ] Fix drop indicator rendering: currently shows after node regardless of `before`/`after` position
- [ ] Show indicator above node when `dragOverPosition() === "before"`, below when `"after"`

## Phase 4: Verification

- [ ] Right-click group → "删除分组" appears and works
- [ ] Drag connection within same group → reorders correctly, no duplication
- [ ] Drag connection from group A to group B → moves without duplication
- [ ] Drag connection to "移出分组" zone → removes from group
- [ ] Existing right-click menu options on connections still work
