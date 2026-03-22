# Bugfix Design Document

## Overview

This document describes the design for fixing sidebar grouping issues:
1. Missing "Delete Group" option in the group context menu
2. No drag-and-drop functionality for reordering connections within groups

## Bug Condition Methodology

### Bug Condition C(X)

**C(X)** identifies inputs/conditions that trigger the bugs:
- `C1(X)`: X is a connection group node in the sidebar
- `C2(X)`: X is a drag operation on a connection node with target position between two existing connections
- `C3(X)`: X is a drag operation from one group to another group

### Properties P(result)

**P1(result)**: Delete Group menu option exists and works correctly
- The context menu for a group node includes "Delete Group" option
- Selecting "Delete Group" removes the group and all connections within it

**P2(result)**: Drag-and-drop reordering works correctly
- When dropping between two connections, the dragged connection is inserted at that position
- When dropping at the end of a group, the dragged connection is appended

**P3(result)**: Cross-group drag-and-drop moves without duplication
- When dragging from one group to another, the connection is moved (not copied)
- The source group no longer contains the connection after the operation

### Non-buggy Inputs ¬C(X)

**¬C1(X)**: X is not a group node (no delete group expectation)
**¬C2(X)**: X is a drag operation with simple drop (not between connections)
**¬C3(X)**: X is a drag operation within the same group

## Implementation Approach

### 1. Add Delete Group Menu Option

**Location**: `sidebar.tsx` - `handleMenuAction` function

**Changes**:
- Add "deleteGroup" case to the switch statement in `handleMenuAction`
- When action is "deleteGroup":
  - Get the group name from the menu node
  - Show confirmation dialog
  - Call API to delete the group
  - Refresh saved connections

**API Call**: Need to add `deleteGroup(groupName: string)` function in `connection-storage.ts`

### 2. Implement Drag-and-Drop for Reordering

**Location**: `sidebar.tsx` - Add drag-and-drop handlers

**Changes**:
- Add drag event handlers to connection nodes:
  - `onDragStart`: Set dragged connection data
  - `onDragOver`: Enable drop and show visual feedback
  - `onDrop`: Handle drop at target position
- Add drag event handlers to group nodes:
  - `onDragOver`: Show visual feedback for group drop
  - `onDrop`: Handle drop at group level

**Drop Position Detection**:
- Calculate drop position relative to sibling connections
- Determine if drop is between two connections or at group level

**Reordering Logic**:
- Get current group connections
- Remove dragged connection from source position
- Insert at target position
- Update group via `updateStoredConnectionMeta`

### 3. Fix Cross-Group Drag-and-Drop

**Issue**: Connections get duplicated when moved between groups

**Root Cause**: Current implementation may be copying instead of moving

**Fix**:
- Ensure drag operation removes from source group
- Update connection's group metadata to target group
- Refresh both source and target groups

## Technical Details

### Data Structures

```typescript
interface StoredConnectionItem {
  id: string;
  label: string;
  enc?: string;
  name?: string;
}

interface StoredConnectionGroup {
  group: string;
  connections: StoredConnectionItem[];
}

type ConnectionList = (StoredConnectionItem | StoredConnectionGroup)[];
```

### Drag-and-Drop Implementation

```typescript
// Drag start handler
function handleDragStart(e: DragEvent, node: TreeNode) {
  e.dataTransfer.setData('application/json', JSON.stringify({
    type: node.type,
    storedId: node.storedId,
    sourceGroup: node.group,
  }));
  e.dataTransfer.effectAllowed = 'move';
}

// Drag over handler
function handleDragOver(e: DragEvent) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

// Drop handler
function handleDrop(e: DragEvent, targetGroup: string, targetIndex?: number) {
  const data = JSON.parse(e.dataTransfer.getData('application/json'));
  if (data.type === 'savedConnection' && data.storedId) {
    // Remove from source
    // Add to target at position
    updateStoredConnectionMeta(data.storedId, { group: targetGroup });
  }
}
```

### API Changes

**New API in `connection-storage.ts`**:
```typescript
export async function deleteGroup(groupName: string): Promise<void>;
```

**Backend API in `transport.ts`**:
```typescript
| "connections/delete-group"
```

## Testing Strategy

### Fix Checking (C(X) inputs)
1. Right-click on group → verify "Delete Group" option exists
2. Drag connection between two connections → verify reordering
3. Drag connection from group A to group B → verify no duplication

### Preservation Checking (¬C(X) inputs)
1. Right-click on connection → verify existing menu options unchanged
2. Drag connection within same group → verify existing behavior preserved
3. Create new group → verify existing functionality unchanged
