# Bugfix Requirements Document

## Introduction

This bugfix addresses two issues in the sidebar connection grouping functionality:
1. Missing "Delete Group" option in the group context menu
2. No drag-and-drop functionality for reordering connections 

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN right-clicking on a connection group THEN the context menu only shows "新建分组" (Create New Group) without a "Delete Group" option

1.2 WHEN dragging a connection from one group to another group AND attempting to drop it between two existing connections in the target group THEN the drag-and-drop operation fails to reorder connections properly

1.3 WHEN dragging a connection between groups THEN the connection gets duplicated instead of being moved

### Expected Behavior (Correct)

2.1 WHEN right-clicking on a connection group THEN the context menu SHALL include a "Delete Group" option

2.2 WHEN dragging a connection within a group AND dropping it between two existing connections THEN the system SHALL reorder the connections to place the dragged connection at the drop position

2.3 WHEN dragging a connection from one group to another group AND dropping it between two existing connections THEN the system SHALL move the connection to the target position without duplication

2.4 WHEN dragging a connection from one group to another group AND dropping it at the end of the target group THEN the system SHALL append the connection to the end of the target group

2.5 WHEN deleting a group via the context menu THEN the system SHALL remove the group and all connections within it

### Unchanged Behavior (Regression Prevention)

3.1 WHEN right-clicking on a connection group AND selecting "新建分组" THEN the system SHALL continue to create a new empty group

3.2 WHEN right-clicking on a saved connection AND selecting "编辑" (Edit) THEN the system SHALL continue to open the connection edit form

3.3 WHEN right-clicking on a saved connection AND selecting "删除" (Delete) THEN the system SHALL continue to remove the saved connection

3.4 WHEN right-clicking on a connection AND selecting "断开连接" (Disconnect) THEN the system SHALL continue to disconnect the active connection

3.5 WHEN right-clicking on a connection AND selecting "新建查询" (New Query) THEN the system SHALL continue to open a new query tab

3.6 WHEN dragging a connection from outside any group AND dropping it into a group THEN the system SHALL continue to add the connection to that group

3.7 WHEN right-clicking on a connection group AND selecting any existing menu option THEN the system SHALL continue to execute the corresponding action as before
